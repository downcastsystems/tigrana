// Run with a Vite dev server and an external Playwright installation.
// node scripts/check-theme-link-dimming.mjs /path/to/playwright http://localhost:1420
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {webkit}=require(process.argv[2] || 'playwright');
const base=process.argv[3] || 'http://localhost:1420';
const browser=await webkit.launch();
try {
  const page=await browser.newPage();
  await page.goto(`${base}/scripts/fixtures/theme-link-dimming.html`);
  await page.waitForFunction(()=>window.themes);
  const themes=await page.evaluate(()=>window.themes);
  const failures=[];
  for(const theme of themes) for(const mode of ['light','dark']) {
    const result=await page.evaluate(({id,mode})=>{
      window.showTheme(id,mode);
      const links=document.querySelectorAll('.ProseMirror a');
      const pixel=node=>{const ctx=document.createElement('canvas').getContext('2d');ctx.fillStyle=getComputedStyle(node).color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]};
      const normal=pixel(links[0]),dim=pixel(links[1]),red=pixel(links[2].firstChild);
      document.querySelector('[data-bullet-method-dim]').removeAttribute('data-bullet-method-dim');
      const disabled=pixel(links[1]);
      links[1].parentElement.setAttribute('data-bullet-method-dim','true');
      return {normal,dim,red,disabled};
    },{id:theme.id,mode});
    try {
      assert.ok(Math.abs(result.dim[3]-result.normal[3]*(mode==='light'?.65:.8))<=1);
      assert.deepEqual(result.disabled,result.normal);
      assert.deepEqual(result.red,[200,20,20,255]);
    } catch {failures.push({theme:theme.name,mode,...result})}
  }
  assert.deepEqual(failures,[]);
  console.log(`Verified ${themes.length} themes in both modes: dimming, disabling dimming, and explicit text colors.`);
} finally {await browser.close()}
