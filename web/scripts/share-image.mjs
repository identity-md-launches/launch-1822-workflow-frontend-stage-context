import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

// A local, code-drawn share card. No remote image or font requests.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<html lang="en"><style>*{box-sizing:border-box}body{margin:0;background:#f8f3e9;color:#342d28;font-family:Georgia,serif;padding:76px}header{font:24px system-ui;color:#a92429}h1{font-size:74px;line-height:1.1;width:650px;margin:52px 0 24px}p{font:26px system-ui;color:#73685c}svg{position:absolute;right:80px;top:130px;width:260px;height:350px}footer{position:absolute;bottom:65px;font:20px system-ui;color:#73685c}</style><header>IMD Hongbao</header><h1>Share a little<br>good fortune.</h1><p>On-chain red packets, filled with IMD.</p><svg viewBox="0 0 230 300" fill="none"><rect x="8" y="8" width="214" height="284" rx="20" fill="#a92429"/><rect x="19" y="19" width="192" height="262" rx="13" stroke="#edcc86" stroke-width="2"/><path d="M9 65q106 120 212 0" stroke="#edcc86" stroke-width="2"/><circle cx="115" cy="123" r="32" fill="#edcc86"/><rect x="104" y="112" width="22" height="22" fill="#a92429"/><path d="M58 235h114M78 248h74" stroke="#edcc86" stroke-width="2"/></svg><footer>Send · Share · Open &nbsp; / &nbsp; Robinhood Chain</footer></html>`,
  );
  await page.screenshot({
    path: fileURLToPath(new URL("../public/share.png", import.meta.url)),
  });
} finally {
  await browser.close();
}
