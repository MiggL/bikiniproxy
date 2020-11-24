const { stateCollector, reproductionProxy, utils } = require('DeadClick');
const repairModels = require('../../repair_models/repair_models');
const Bikiniproxy = require('../../repair_models/bikiniproxy');
const fs = require('fs');
const path = require('path');
const URL = require('url');

function getState(url, proxyUrl = null, extension = null) {
  return stateCollector.collectPage({
    url: url,
    proxy: proxyUrl,
    collectScreenShot: true,
    extension: extension,
    timeout:25000
  });
}

function isJavascriptRequest(contentType) {
  const contentTypeLowerCase = contentType.toLowerCase();
  const contentTypeMatch = contentTypeLowerCase.indexOf('html') !== -1
                        || contentTypeLowerCase.indexOf('javascript') !== -1
                        || contentTypeLowerCase.indexOf('js') !== -1;
  return contentTypeMatch;
}

async function repairUrls(urls, savePath, requestsPath = utils.requestsPath) {
  const proxy = await reproductionProxy.startReproductionProxy(8010, requestsPath);

  let repairOutput = [];
  proxy.onRequest = async function(request) {
    if (request.statusCode === 500) {
      const url = new URL.URL(request.url);
      if (url.searchParams.has('bikinirepair')) {
        url.searchParams.delete('bikinirepair');

        const newOption = Object.assign({}, request.requestDetail.requestOptions);
        newOption.path = url.pathname + url.searchParams;
        return { requestOptions: newOption };
      } else {
        return request;
      }
    }
    if (!isJavascriptRequest(request.contentType)) {
      return request;
    }

    (new repairModels[0]).resetASTCache();
    for (const error of proxy.requestState.errors) {
      for (const RepairModel of repairModels) {
        if (error.handled) {
          continue;
        }
        const repairModel = new RepairModel(proxy.requestState, error, request);
        const isEnable = repairModel.isEnable();
        const isToApply = await repairModel.isToApply();
        if (isEnable && isToApply) {
          await repairModel.repair();
          console.log('bingo');
          const output = { url: request.url, name: repairModel.name, description: repairModel.description, enable: isEnable, isToApply: isEnable ? isToApply : false, error: error };
          //console.log(output);
          repairOutput.push(output);
          // console.log(error.exceptionDetails);
        }
      }
    }
    return request;
  }

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log('\nAttempting repair on url ' + (i + 1) + '/' + urls.length);
    console.log(url);
    try {
      const originalState = await utils.loadState(url, path.join(requestsPath, '../webtraces/'));
      console.log('Errors without Privacy Badger = ' + originalState.errors.length);
      const expectedState = await utils.loadState(url, requestsPath);
      console.log('Errors with Privacy Badger =    ' + expectedState.errors.length);
      // console.log(await reproductionProxy.reproduceRequestState(expectedState, proxy));
      proxy.requestState = expectedState;
      const collectedState = await getState(url, 'localhost:' + proxy.port, path.join(__dirname, '../../privacy-badger/2020.8.25_0'));
      console.log('Errors after repair =           ' + collectedState.errors.length);
      if (savePath) {
        await stateCollector.serializeState(collectedState, savePath);
      }

      // add repair data to file
      const repairDataFile = path.join(requestsPath, '../from_proxy_data/repairData.json');
      fs.readFile(repairDataFile, (err, data) => {
        let repairsArray = err ? [] : JSON.parse(data); // err should only occur if file doesn't exist
        if (repairsArray.filter(r => r.url === url).length != 0) {
          repairsArray = repairsArray.map(r => if (r.url === url) r.repairs = repairOutput);
        } else {
          repairsArray.push({url: url, repairs: repairOutput});
        }
        fs.writeFileSync(repairDataFile, JSON.stringify(repairsArray, null, 2));
      });

      repairOutput = [];
    } catch (e) {
      console.error('ERROR WHEN REPAIRING');
      console.error(e);
    }
  }
}

(async () => {
  const dataDir = '../data_sep_2020/randomDuckduckgoUrls';
  const webtracesPbDir = path.join(dataDir, 'webtraces_pb/');
  const webtracesPbRepairedDir = path.join(dataDir, 'webtraces_pb_repaired_new/');
  const urls = JSON.parse(fs.readFileSync(path.join(dataDir, 'from_proxy_data/pbErrorUrls.json')));
  await repairUrls(urls, webtracesPbRepairedDir, webtracesPbDir);
  await utils.closeBrowser();
  process.exit(0);
})();
