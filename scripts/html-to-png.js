const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// PNG 파일 재귀 삭제
function deletePngs(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(function(item) {
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) {
      deletePngs(full);
    } else if (item.endsWith('.png')) {
      fs.unlinkSync(full);
      console.log('🗑️ 삭제: ' + full);
    }
  });
}

// HTML 파일 재귀 탐색
function findHtmlFiles(dir, result) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(function(item) {
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) {
      findHtmlFiles(full, result);
    } else if (item.endsWith('.html')) {
      result.push(full);
    }
  });
}

// 폰트 CSS를 로컬 node_modules에서 읽어 <style> 태그로 직접 임베드
function buildFontStyles() {
  const fontsourcePkgs = [
    path.join(__dirname, '..', 'node_modules', '@fontsource', 'inter', 'index.css'),
    path.join(__dirname, '..', 'node_modules', '@fontsource', 'noto-sans-kr', 'index.css'),
    path.join(__dirname, '..', 'node_modules', '@fontsource', 'noto-sans-jp', 'index.css'),
    path.join(__dirname, '..', 'node_modules', '@fontsource', 'noto-sans-sc', 'index.css'),
    path.join(__dirname, '..', 'node_modules', '@fontsource', 'noto-color-emoji', 'index.css'),
    path.join(__dirname, '..', 'node_modules', 'pretendard', 'dist', 'web', 'static', 'pretendard.css'),
  ];

  let combined = '';
  fontsourcePkgs.forEach(function(cssPath) {
    if (!fs.existsSync(cssPath)) return;
    let css = fs.readFileSync(cssPath, 'utf-8');
    // @fontsource의 url(./files/...) 를 절대 파일 경로로 변환
    const cssDir = path.dirname(cssPath);
    css = css.replace(/url\(['"]?\.(\/[^)'"]+)['"]?\)/g, function(match, relPath) {
      const absPath = path.join(cssDir, relPath).replace(/\\/g, '/');
      return 'url("file:///' + absPath + '")';
    });
    combined += css + '\n';
  });
  return combined;
}

function wrapHtml(html) {
  const fontStyles = buildFontStyles();
  return '<!DOCTYPE html>' +
    '<html><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=850">' +
    '<style>' + fontStyles + '</style>' +
    '<style>' +
    '* { margin: 0; padding: 0; box-sizing: border-box; font-family: \'Pretendard\', \'Noto Sans KR\', \'Noto Sans JP\', \'Noto Sans SC\', \'Inter\', \'Noto Color Emoji\', sans-serif !important; }' +
    'body { background: white; width: 850px; }' +
    '</style>' +
    '</head><body>' + html + '</body></html>';
}

async function convertAll() {
  const rootDir = path.join(__dirname, '..');
  const perfDir = path.join(rootDir, 'performances');
  const sharedDir = path.join(rootDir, 'shared');

  // 기존 PNG 삭제
  deletePngs(perfDir);
  deletePngs(sharedDir);

  // HTML 파일 수집
  const htmlFiles = [];
  findHtmlFiles(perfDir, htmlFiles);
  findHtmlFiles(sharedDir, htmlFiles);

  if (htmlFiles.length === 0) {
    console.log('변환할 HTML 없음');
    console.log('탐색 경로:');
    console.log('  performances: ' + perfDir + ' exists=' + fs.existsSync(perfDir));
    console.log('  shared:       ' + sharedDir + ' exists=' + fs.existsSync(sharedDir));
    return;
  }

  console.log('📸 총 ' + htmlFiles.length + '개 HTML 변환 시작');
  htmlFiles.forEach(function(f) { console.log('  📄 ' + f); });

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
      const hasSlices = html.includes('data-slice=');
      const generatedPngs = [];

      const fullHtml = wrapHtml(html);
      const page = await browser.newPage();
      await page.setViewport({ width: 850, height: 1 });

      const tempPath = path.join(rootDir, 'temp_render.html');
      fs.writeFileSync(tempPath, fullHtml);
      const tempUrl = 'file:///' + tempPath.replace(/\\/g, '/');
      await page.goto(tempUrl, { waitUntil: 'networkidle0', timeout: 30000 });

      // 폰트 로딩 대기
      await page.evaluate(async function() {
        await document.fonts.ready;
        var fontFaces = Array.from(document.fonts.values());
        await Promise.all(fontFaces.map(function(f) {
          return f.load().catch(function() {});
        }));
      });
      await new Promise(function(r) { setTimeout(r, 2000); });

      const bodyHeight = await page.evaluate(function() { return document.body.scrollHeight; });
      await page.setViewport({ width: 850, height: bodyHeight + 50 });

      if (hasSlices) {
        const slices = await page.$$('[data-slice]');
        for (const slice of slices) {
          const sliceNum = await page.evaluate(function(el) { return el.getAttribute('data-slice'); }, slice);
          const pngPath = file.replace('.html', '_' + sliceNum + '.png');
          await slice.screenshot({ path: pngPath, type: 'png', omitBackground: false });
          console.log('  ✅ ' + path.basename(file) + ' → slice ' + sliceNum + '.png');
          generatedPngs.push(pngPath);
        }
      } else {
        const pngPath = file.replace('.html', '.png');
        const el = await page.$('section') || await page.$('body');
        await el.screenshot({ path: pngPath, type: 'png', omitBackground: false });
        console.log('  ✅ ' + path.basename(file) + ' → .png');
        generatedPngs.push(pngPath);
      }

      await page.close();

    } catch (e) {
      console.error('  ❌ ' + file + ': ' + e.message);
    }
  }

  await browser.close();
  console.log('🎉 변환 완료!');
}

convertAll().catch(console.error);
