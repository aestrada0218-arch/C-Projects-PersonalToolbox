import { spawn } from "node:child_process";
import { join } from "node:path";
export type MailSecret = { email: string; appPassword: string };
export interface CredentialVault<T = MailSecret> {
  read(): Promise<T | null>;
  write(secret: T): Promise<void>;
  remove(): Promise<void>;
}
// Static source only: credential values travel over stdin/stdout pipes, never command arguments.
export const credentialScript = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;
public static class ToolboxCredential {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct Credential {
  public uint Flags; public uint Type; public string TargetName; public string Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
  public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
 }
 [DllImport("advapi32.dll",EntryPoint="CredWriteW",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern bool Write(ref Credential credential,uint flags);
 [DllImport("advapi32.dll",EntryPoint="CredReadW",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern bool Read(string target,uint type,uint flags,out IntPtr credential);
 [DllImport("advapi32.dll",EntryPoint="CredDeleteW",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern bool Delete(string target,uint type,uint flags);
 [DllImport("advapi32.dll")] static extern void CredFree(IntPtr credential);

 public static void Save(string target, string value) {
  var ptr=Marshal.StringToCoTaskMemUni(value);
  try { var c=new Credential {Type=1,TargetName=target,CredentialBlobSize=(uint)(value.Length*2),CredentialBlob=ptr,Persist=2,UserName="PersonalToolbox"};
   if(!Write(ref c,0))throw new Win32Exception(Marshal.GetLastWin32Error());
  } finally {Marshal.ZeroFreeCoTaskMemUnicode(ptr);}
 }
 public static string Load(string target) {
  IntPtr ptr;
  if(!Read(target,1,0,out ptr)){if(Marshal.GetLastWin32Error()==1168)return null;throw new Win32Exception(Marshal.GetLastWin32Error());}
  try {var c=(Credential)Marshal.PtrToStructure(ptr,typeof(Credential));return Marshal.PtrToStringUni(c.CredentialBlob,(int)c.CredentialBlobSize/2);} finally {CredFree(ptr);}
 }
 public static void Remove(string target){if(!Delete(target,1,0)&&Marshal.GetLastWin32Error()!=1168)throw new Win32Exception(Marshal.GetLastWin32Error());}
}
'@
try {
 $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
 switch($request.action){
  'read' { $value=[ToolboxCredential]::Load([string]$request.target); if($null -eq $value){[Console]::Write('null')}else{[Console]::Write($value)} }
  'write' { [ToolboxCredential]::Save([string]$request.target,($request.secret | ConvertTo-Json -Compress)); [Console]::Write('null') }
  'remove' { [ToolboxCredential]::Remove([string]$request.target); [Console]::Write('null') }
  default {throw 'Invalid operation'}
 }
} catch {exit 1}
`;
export class WindowsCredentialVault<
  T = MailSecret,
> implements CredentialVault<T> {
  constructor(private target = "PersonalToolbox/GmailIMAP/v1") {
    if (!/^PersonalToolbox\/[A-Za-z0-9/-]{1,100}$/.test(target))
      throw new Error("Invalid credential target");
  }
  private async call(
    action: "read" | "write" | "remove",
    secret?: T,
  ): Promise<T | null> {
    if (process.platform !== "win32") throw new Error("CREDENTIAL_UNAVAILABLE");
    const executable = join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    return new Promise((resolve, reject) => {
      const child = spawn(
        executable,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(credentialScript, "utf16le").toString("base64"),
        ],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "";
      let failed = false;
      const fail = () => {
        if (!failed) {
          failed = true;
          reject(new Error("CREDENTIAL_UNAVAILABLE"));
        }
      };
      const timer = setTimeout(() => {
        child.kill();
        fail();
      }, 30000);
      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
        if (output.length > 8192) {
          child.kill();
          fail();
        }
      });
      child.stderr.on("data", () => {}); // Never log PowerShell output; it could contain a secret.
      child.on("error", () => {
        clearTimeout(timer);
        fail();
      });
      child.stdin.on("error", () => fail());
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failed) return;
        if (code !== 0) {
          fail();
          return;
        }
        try {
          resolve(JSON.parse(output.replace(/^\uFEFF/, "").trim()));
        } catch {
          fail();
        }
      });
      child.stdin.end(JSON.stringify({ action, secret, target: this.target }));
    });
  }
  read() {
    return this.call("read");
  }
  async write(secret: T) {
    await this.call("write", secret);
  }
  async remove() {
    await this.call("remove");
  }
}
