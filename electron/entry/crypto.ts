export interface ProfileCipher {
  available(): boolean;
  encrypt(text: string): Uint8Array;
  decrypt(bytes: Uint8Array): string;
}
export class UnavailableProfileCipher implements ProfileCipher {
  available() {
    return false;
  }
  encrypt(_text: string): Uint8Array {
    throw Error("ENTRY_ENCRYPTION");
  }
  decrypt(_bytes: Uint8Array): string {
    throw Error("ENTRY_ENCRYPTION");
  }
}
export class WindowsProfileCipher implements ProfileCipher {
  constructor(
    private storage: {
      isEncryptionAvailable(): boolean;
      encryptString(text: string): Buffer;
      decryptString(bytes: Buffer): string;
    },
    private platform = process.platform,
  ) {}
  available() {
    return this.platform === "win32" && this.storage.isEncryptionAvailable();
  }
  encrypt(text: string) {
    if (!this.available()) throw Error("ENTRY_ENCRYPTION");
    return new Uint8Array(this.storage.encryptString(text));
  }
  decrypt(bytes: Uint8Array) {
    if (!this.available()) throw Error("ENTRY_ENCRYPTION");
    return this.storage.decryptString(Buffer.from(bytes));
  }
}
