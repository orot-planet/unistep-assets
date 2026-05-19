const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

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
    '<meta name="viewport" content="width=860">' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&family=Noto+Sans+JP:wght@400;700;900&family=Noto+Sans+SC:wght@400;700;900&family=Inter:wght@400;700;900&display=swap" rel="stylesheet">' +
    '<style>' +
    '* { margin:0; padding:0; box-sizing:border-box;' +
    '    font-family: "Noto Sans KR","Noto Sans JP","Noto Sans SC","Inter","Noto Color Emoji","Noto Sans CJK KR","Noto Sans CJK JP","Noto Sans CJK SC", sans-serif !important; }' +
    'body { background:white; width:860px; }' +
    '</style>' +
    '</head><body>' + html + '</body></html>';
}

// ── GIF 다운로드 함수 ──
function downloadFile(url, destPath) {
  return new Promise(function(resolve, reject) {
    var mod = url.startsWith('https') ? https : http;
    mod.get(url, function(response) {
      // 리다이렉트 처리
      if (response.statusCode === 301 || response.statusCode === 302) {
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        return reject(new Error('HTTP ' + response.statusCode + ' for ' + url));
      }
      var fileStream = fs.createWriteStream(destPath);
      response.pipe(fileStream);
      fileStream.on('finish', function() { fileStream.close(resolve); });
      fileStream.on('error', reject);
    }).on('error', reject);
  });
}

// ── 슬라이스 HTML에서 GIF URL 추출 ──
function extractGifUrls(sliceHtml) {
  var gifUrls = [];
  var regex = /src=["']([^"']*\.gif)["']/gi;
  var match;
  while ((match = regex.exec(sliceHtml)) !== null) {
    gifUrls.push(match[1]);
  }
  return gifUrls;
}

async function convertAll() {
  const rootDir = path.join(__dirname, '..');
  const perfDir = path.join(rootDir, 'performances');
  const sharedDir = path.join(rootDir, 'shared');

  var htmlFiles = [];

  // ── TARGET 모드: 변경된 파일만 변환 (AppScript push 시) ──
  var targetEnv = process.env.TARGET_HTML_FILES || '';
  if (targetEnv.trim()) {
    var targets = targetEnv.split('\n').map(function(f) { return f.trim(); }).filter(Boolean);
    targets.forEach(function(relPath) {
      var abs = path.join(rootDir, relPath);
      if (fs.existsSync(abs)) {
        htmlFiles.push(abs);
        // 기존 PNG/GIF 삭제 (해당 파일 기준)
        var dir = path.dirname(abs);
        var base = path.basename(abs, '.html');
        fs.readdirSync(dir).forEach(function(f) {
          if (f.startsWith(base) && (f.endsWith('.png') || f.match(/_\d+_gif\d+\.gif$/))) {
            fs.unlinkSync(path.join(dir, f));
            console.log('🗑️ 삭제: ' + f);
          }
        });
      } else {
        console.log('⚠️ 파일 없음: ' + relPath);
      }
    });
    console.log('🎯 타겟 변환 모드: ' + htmlFiles.length + '개 파일');
  } else {
    // ── 전체 모드: workflow_dispatch 또는 수동 실행 ──
    findHtmlFiles(perfDir, htmlFiles);
    findHtmlFiles(sharedDir, htmlFiles);
    console.log('🌐 전체 변환 모드: ' + htmlFiles.length + '개 파일');
  }


  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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
      var generatedAssets = [];  // { type: 'png'|'gif', path, order, sliceNum }

      var fullHtml = wrapHtml(html);
      var page = await browser.newPage();
      await page.setViewport({ width: 860, height: 1, deviceScaleFactor: 2 });
      await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 30000 });

      // 폰트 로딩 대기
      await page.evaluate(function() {
        return document.fonts.ready;
      });
      await new Promise(function(r) { setTimeout(r, 2000); });

      var bodyHeight = await page.evaluate(function() { return document.body.scrollHeight; });
      await page.setViewport({ width: 860, height: bodyHeight + 50, deviceScaleFactor: 2 });

      if (hasSlices) {
        var slices = await page.$$('[data-slice]');
        var orderNum = 0;

        for (var s = 0; s < slices.length; s++) {
          var sliceNum = await page.evaluate(function(el) { return el.getAttribute('data-slice'); }, slices[s]);
          var sliceHtml = await page.evaluate(function(el) { return el.innerHTML; }, slices[s]);

          // GIF URL 감지
          var gifUrls = extractGifUrls(sliceHtml);

          // 항상 PNG 캡쳐 (GIF 포함 슬라이스도 정적 fallback으로)
          orderNum++;
          var pngPath = file.replace('.html', '_' + sliceNum + '.png');
          await slices[s].screenshot({ path: pngPath, type: 'png', omitBackground: false });

          if (gifUrls.length > 0) {
            console.log('  📸 ' + path.basename(file) + ' → slice ' + sliceNum + '.png (⚠️ GIF 포함 - 정적 fallback)');
          } else {
            console.log('  ✅ ' + path.basename(file) + ' → slice ' + sliceNum + '.png');
          }

          generatedAssets.push({
            type: 'png',
            path: pngPath,
            order: orderNum,
            sliceNum: sliceNum,
            hasGif: gifUrls.length > 0
          });

          // GIF가 있으면 다운로드
          for (var g = 0; g < gifUrls.length; g++) {
            var gifUrl = gifUrls[g];
            var gifFilename = path.basename(file, '.html') + '_' + sliceNum + '_gif' + (g + 1) + '.gif';
            var gifPath = path.join(path.dirname(file), gifFilename);

            try {
              await downloadFile(gifUrl, gifPath);
              orderNum++;
              generatedAssets.push({
                type: 'gif',
                path: gifPath,
                order: orderNum,
                sliceNum: sliceNum,
                sourceUrl: gifUrl
              });
              console.log('  🎞️ ' + path.basename(file) + ' → slice ' + sliceNum + ' GIF 다운로드: ' + gifFilename);
            } catch (gifErr) {
              console.error('  ⚠️ GIF 다운로드 실패: ' + gifUrl + ' → ' + gifErr.message);
            }
          }
        }
      } else {
        var pngPath = file.replace('.html', '.png');
        var el = await page.$('section') || await page.$('body');
        await el.screenshot({ path: pngPath, type: 'png', omitBackground: false });
        console.log('  ✅ ' + path.basename(file) + ' → .png');
        generatedAssets.push({ type: 'png', path: pngPath, order: 1, sliceNum: '1' });
      }

      // ── 매니페스트 생성 (에셋 업로드 순서표) ──
      if (generatedAssets.length > 0) {
        var manifestPath = file.replace('.html', '_manifest.json');
        var manifest = {
          source: path.basename(file),
          generated: new Date().toISOString(),
          totalAssets: generatedAssets.length,
          assets: generatedAssets.map(function(a) {
            return {
              order: a.order,
              type: a.type,
              filename: path.basename(a.path),
              sliceNum: a.sliceNum,
              hasGif: a.hasGif || false,
              sourceUrl: a.sourceUrl || null
            };
          })
        };
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        console.log('  📋 매니페스트: ' + path.basename(manifestPath));

        // GIF가 포함된 경우 업로드 가이드 출력
        var gifAssets = generatedAssets.filter(function(a) { return a.type === 'gif'; });
        if (gifAssets.length > 0) {
          console.log('  ──────────────────────────────────────');
          console.log('  📌 아임웹 업로드 순서 (' + path.basename(file) + '):');
          generatedAssets.forEach(function(a) {
            if (a.type === 'png' && a.hasGif) {
              console.log('    ' + a.order + '. ⏭️  SKIP (GIF로 대체) → ' + path.basename(a.path));
            } else if (a.type === 'gif') {
              console.log('    ' + a.order + '. 🎞️  GIF 업로드 → ' + path.basename(a.path));
            } else {
              console.log('    ' + a.order + '. 🖼️  PNG 업로드 → ' + path.basename(a.path));
            }
          });
          console.log('  ──────────────────────────────────────');
        }
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
