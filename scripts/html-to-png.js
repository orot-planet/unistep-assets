const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function convertAll() {
  const perfDir = path.join(__dirname, '..', 'performances');
  if (!fs.existsSync(perfDir)) { console.log('performances 폴더 없음'); return; }

  const htmlFiles = [];
  findHtmlFiles(perfDir, htmlFiles);

  if (htmlFiles.length === 0) { console.log('변환할 HTML 없음'); return; }

  console.log('📸 총 ' + htmlFiles.length + '개 HTML 변환 시작');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  for (const file of htmlFiles) {
    try {
      const html = fs.readFileSync(file, 'utf-8');

      // data-slice 속성이 있으면 → 구획별 분할 스크린샷
      // 없으면 → 전체 1장 스크린샷
      const hasSlices = html.includes('data-slice=');

      // 구글 드라이브 폴더 ID 추출
      const driveMatch = html.match(/data-folder-id="([^"]+)"/);
      const folderId = driveMatch ? driveMatch[1] : null;
      const generatedPngs = [];

      const fullHtml = wrapHtml(html);
      const page = await browser.newPage();
      await page.setViewport({ width: 850, height: 1 });
      await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 30000 });

      // 폰트 로딩 대기
      await page.evaluate(() => document.fonts.ready);
      await new Promise(r => setTimeout(r, 1000));

      // 콘텐츠 높이로 리사이즈
      const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
      await page.setViewport({ width: 850, height: bodyHeight + 50 });

      if (hasSlices) {
        // ── 구획 분할 모드 ──
        const slices = await page.$$('[data-slice]');
        for (const slice of slices) {
          const sliceNum = await page.evaluate(el => el.getAttribute('data-slice'), slice);
          const pngPath = file.replace('.html', '_' + sliceNum + '.png');
          await slice.screenshot({ path: pngPath, type: 'png', omitBackground: false });
          console.log('  ✅ ' + path.basename(file) + ' → slice ' + sliceNum + '.png');
          generatedPngs.push(pngPath);
        }
      } else {
        // ── 전체 1장 모드 (sum HTML 등) ──
        const pngPath = file.replace('.html', '.png');
        const el = await page.$('section') || await page.$('body');
        await el.screenshot({ path: pngPath, type: 'png', omitBackground: false });
        console.log('  ✅ ' + path.basename(file) + ' → .png');
      }

      await page.close();

    } catch (e) {
      console.error('  ❌ ' + file + ': ' + e.message);
    }
  }

  await browser.close();
  console.log('🎉 변환 완료!');
}

function wrapHtml(html) {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=850">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;800&family=Noto+Sans+SC:wght@400;700;800&family=Inter:wght@400;700;800&display=swap" rel="stylesheet">
<style>
  @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: white; width: 850px; }
</style>
</head><body>${html}</body></html>`;
}

function findHtmlFiles(dir, result) {
  const items = fs.readdirSync(dir);
  items.forEach(function(item) {
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) {
      findHtmlFiles(full, result);
    } else if (item.endsWith('.html')) {
      result.push(full);
    }
  });
}

convertAll().catch(console.error);
