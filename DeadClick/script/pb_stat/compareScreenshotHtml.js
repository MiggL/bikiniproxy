const fs = require('fs');
const path = require('path');
const { utils, reproductionProxy } = require('DeadClick');
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch');
const md5 = require('md5');
const HtmlDiffer = require('@markedjs/html-differ').HtmlDiffer;
const htmlDiffer = new HtmlDiffer({
  "ignoreAttributes": [],
  "compareAttributesAsJSON": [],
  "ignoreWhitespaces": true,
  "ignoreComments": true,
  "ignoreSelfClosingSlash": true,
  "ignoreEndTags": false
});

const repairedUrls = JSON.parse(fs.readFileSync('lessErrorsAfterPbRepair2.json'));
const webtracesDir = path.join(__dirname, '../../data_sep_2020/randomDuckduckgoUrls/webtraces/');
const webtracesPbDir = path.join(webtracesDir, '../webtraces_pb/');
const webtracesPbRepairedDir = path.join(webtracesDir, '../repaired2_webtraces_pb/');

(async () => {
  const scDiffUrls = repairedUrls.filter((url, i) => {
    if ((i+1) % 10 == 0) console.log(i+1, '/', repairedUrls.length);
    const md5url = md5(url);

    const oldScreenshot = PNG.sync.read(fs.readFileSync(`${webtracesPbDir}${md5url}/screenshot.png`));
    const newScreenshot = PNG.sync.read(fs.readFileSync(`${webtracesPbRepairedDir}${md5url}/screenshot.png`));
    if (oldScreenshot.height !== newScreenshot.height || oldScreenshot.width !== newScreenshot.width) {
      return true;
    }
    const { width, height } = newScreenshot;
    const diff = new PNG({width, height});
    if (pixelmatch(oldScreenshot.data, newScreenshot.data, diff.data, width, height, { threshold: 0.1}) === 0) {
      return false;
    }
    //fs.writeFileSync(`screenshot_diffs_repaired/${md5url}.png`, PNG.sync.write(diff));
    return true;
  });
  console.log(scDiffUrls.length, 'urls show a different screenshot after being repaired');
  fs.writeFileSync('screenshotDiff.json', JSON.stringify(scDiffUrls, null, 2));

  //const scDiffUrls = JSON.parse(fs.readFileSync('screenshotDiff.json'));
  const htmlDiffUrls = [];
  for (let i = 0; i < scDiffUrls.length; i++) {
    console.log(i+1, '/', scDiffUrls.length);
    const url = scDiffUrls[i];
    console.log(url);
    /*const skipUrls = [ // These urls take longer than 15mins for htmlDiffer to compare, we correctly assume that this happens because they differ (a lot), so they can be skipped.
      'https://www.si.com/nfl/lions/polls/poll-lions-offer-fan-cut-outs-ford-field',
      'https://www.affordabledentures.com/office/columbus-ga/',
      'https://hclips.com/videos/1488443/beauty-desi-girl-naked-shoot-vidio/#!',
      'https://www.si.com/nfl/jets/news/ny-jets-covid-19-no-fans-nfl-hurts-local-towns',
      'https://fossbytes.com/osi-model-7-layers-osi-model-explained/'
    ];*/
    if (skipUrls.includes(url)) {
      htmlDiffUrls.push(url);
      continue;
    }
    const id = md5(url);
    const pbHtml = fs.readFileSync(`${webtracesPbDir}${id}/loadedContent.html`, 'utf-8');
    const pbRepairedHtml = fs.readFileSync(`${webtracesPbRepairedDir}${id}/loadedContent.html`, 'utf-8');
    const loadedSameContent = await htmlDiffer.isEqual(pbHtml, pbRepairedHtml);
    if (!loadedSameContent) {
      htmlDiffUrls.push(url);
    }
  }
  fs.writeFileSync('htmlDiff.json', JSON.stringify(htmlDiffUrls, null, 2));
  console.log(htmlDiffUrls.length, 'urls also show different loaded html content after being repaired');
})();
