import fs from "fs";
import { exec } from "child_process";
import path from "path";
import os from "os";

export function sendDesktopNotification(titulo, saldo, conta) {
  const tempFile = path.join(os.tmpdir(), `nv_${Date.now()}.ps1`);
  const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = @"
<toast>
  <visual><binding template="ToastGeneric">
    <text>HIT - ${titulo}</text>
    <text>Saldo: ${saldo} | Conta: ${conta}</text>
  </binding></visual>
</toast>
"@
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("TRPC Checker").Show($toast)
`;
  try {
    fs.writeFileSync(tempFile, script, "utf8");
    exec(`powershell -ExecutionPolicy Bypass -File "${tempFile}"`, () => {
      try { fs.unlinkSync(tempFile); } catch {}
    });
  } catch {}
}