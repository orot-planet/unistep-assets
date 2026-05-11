const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function convertAll() {
  const perfDir = path.join(__dirname, '..', 'performances');
  const sharedDir = path.join(__dirname, '..', 'shared');
  
  const htmlFiles = [];
  if (fs.existsSync(perfDir)) findHtmlFiles(perfDir, htmlFiles);
  if (fs.existsSync(sharedDir)) findHtmlFiles(sharedDir, htmlFiles);

  if (htmlFiles.length === 0) { console.log('변환할 HTML 없음'); return; }

  console.log('📸 총 ' + htmlFiles.length + '개 HTML 변환 시작');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--font-render-hinting=none',
      '--disable-font-subpixel-positioning',
      '--force-color-profile=srgb'
    ]
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

      // 폰트 로딩 대기 및 강제 로딩
      await page.evaluate(async () => {
        const fontFaces = Array.from(document.fonts.values());
        await Promise.all(fontFaces.map(f => f.load()));
        await document.fonts.ready;
      });
      await new Promise(r => setTimeout(r, 2000)); // 렌더링 안정화 2초 대기

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
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800;900&family=Noto+Sans+KR:wght@400;700;800;900&family=Noto+Sans+JP:wght@400;700;800;900&family=Noto+Sans+SC:wght@400;700;800;900&display=swap" rel="stylesheet">
<style>
  * { 
    margin: 0; padding: 0; box-sizing: border-box; 
    font-family: 'Pretendard', 'Noto Sans CJK KR', 'Noto Sans CJK JP', 'Noto Sans CJK SC', 'Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC', 'NanumGothic', 'Inter', 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'Symbola', sans-serif !important;
  }
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
