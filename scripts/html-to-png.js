const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

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

function wrapHtml(html) {
  return '<!DOCTYPE html>' +
    '<html><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=850">' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&family=Noto+Sans+JP:wght@400;700;900&family=Noto+Sans+SC:wght@400;700;900&family=Inter:wght@400;700;900&display=swap" rel="stylesheet">' +
    '<style>' +
    '* { margin:0; padding:0; box-sizing:border-box;' +
    '    font-family: "Noto Sans KR","Noto Sans JP","Noto Sans SC","Inter","Noto Color Emoji","Noto Sans CJK KR","Noto Sans CJK JP","Noto Sans CJK SC", sans-serif !important; }' +
    'body { background:white; width:850px; }' +
    '</style>' +
    '</head><body>' + html + '</body></html>';
}

async function convertAll() {
  const rootDir = path.join(__dirname, '..');
  const perfDir = path.join(rootDir, 'performances');
  const sharedDir = path.join(rootDir, 'shared');

  const htmlFiles = [];
  findHtmlFiles(perfDir, htmlFiles);
  findHtmlFiles(sharedDir, htmlFiles);

  if (htmlFiles.length === 0) {
    console.log('변환할 HTML 없음');
    console.log('performances 존재: ' + fs.existsSync(perfDir));
    console.log('shared 존재:       ' + fs.existsSync(sharedDir));
    return;
  }

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

  for (var i = 0; i < htmlFiles.length; i++) {
    var file = htmlFiles[i];
    try {
      var html = fs.readFileSync(file, 'utf-8');
      var hasSlices = html.includes('data-slice=');
      var generatedPngs = [];

      var fullHtml = wrapHtml(html);
      var page = await browser.newPage();
      await page.setViewport({ width: 850, height: 1 });
      await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 30000 });

      // 폰트 로딩 대기
      await page.evaluate(function() {
        return document.fonts.ready;
      });
      await new Promise(function(r) { setTimeout(r, 2000); });

      var bodyHeight = await page.evaluate(function() { return document.body.scrollHeight; });
      await page.setViewport({ width: 850, height: bodyHeight + 50 });

      if (hasSlices) {
        var slices = await page.$$('[data-slice]');
        for (var s = 0; s < slices.length; s++) {
          var sliceNum = await page.evaluate(function(el) { return el.getAttribute('data-slice'); }, slices[s]);
          var pngPath = file.replace('.html', '_' + sliceNum + '.png');
          await slices[s].screenshot({ path: pngPath, type: 'png', omitBackground: false });
          console.log('  ✅ ' + path.basename(file) + ' → slice ' + sliceNum + '.png');
          generatedPngs.push(pngPath);
        }
      } else {
        var pngPath = file.replace('.html', '.png');
        var el = await page.$('section') || await page.$('body');
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
