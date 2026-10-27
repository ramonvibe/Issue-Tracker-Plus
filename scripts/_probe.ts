import { chromium } from "@playwright/test"
const browser = await chromium.launch()
const page = await browser.newPage({ baseURL: "http://localhost:8091" })
await page.request.post("/api/session", { data: { email: "ana@example.com", password: "senha-segura-123" } })
await page.goto("/")
const link = page.getByRole("link", { name: /PLAT\s+Plataforma/ })
await link.waitFor()
await page.waitForTimeout(1000)
const box = await link.boundingBox()
await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
const boxes = []
for (let i = 0; i < 20; i++) {
  boxes.push(await link.evaluate((el) => { const r = el.getBoundingClientRect(); return `${r.x.toFixed(2)},${r.y.toFixed(2)},${r.width.toFixed(2)} ${getComputedStyle(el).transform.slice(0, 40)}` }))
  await page.waitForTimeout(100)
}
console.log(boxes.join("\n"))
await browser.close()
