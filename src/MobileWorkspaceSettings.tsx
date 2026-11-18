export function MobileWorkspaceSettings() {
  return (
    <section className="panel mobile-workspace-settings">
      <h2>iPhone workspace</h2>
      <p>
        This phone can manage your orders, collection, outstanding items,
        expenses, shipment tasks, inbox connections, and selling drafts using
        the same data as your Windows app.
      </p>
      <p>
        Passwords you enter are sent over your private HTTPS connection and
        saved in Windows Credential Manager. Saved passwords and API keys are
        never returned to the phone.
      </p>
      <p>
        CSV exports use Safari downloads; photo and CSV imports use your iPhone
        file picker. TCGplayer links open in Safari—paste a product link into
        card search to find it in your catalog.
      </p>
      <p>
        Manage pairing codes and trusted devices on your Windows PC. Keep the PC
        awake with Personal Toolbox and Tailscale running. Phone changes are not
        queued offline.
      </p>
    </section>
  );
}
