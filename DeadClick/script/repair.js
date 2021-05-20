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

async function repairUrls(urls, savePath, webtracesPath = utils.requestsPath, errorsPath = utils.requestsPath) {
  const proxy = await reproductionProxy.startReproductionProxy(8010, webtracesPath);

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
          const output = { url: request.url, name: repairModel.name, description: repairModel.description, enable: isEnable, isToApply: isEnable ? isToApply : false, error: error };
          repairOutput.push(output);
        }
      }
    }
    return request;
  }
  // If using an old version of Privacy Badger with local learning, uncomment the code below and manually import the training data.
  /*
  proxy.requestState = await utils.loadState(urls[0], webtracesPath);
  await getState(urls[0], 'localhost:' + proxy.port, path.join(__dirname, '../../privacy-badger/2020.8.25_0'));
  proxy.requestState = await utils.loadState(urls[0], webtracesPath);
  await getState(urls[0], 'localhost:' + proxy.port, path.join(__dirname, '../../privacy-badger/2020.8.25_0'));
  //*/

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log('\nAttempting repair on url ' + (i + 1) + '/' + urls.length);
    console.log(url);
    try {
      const originalState = await utils.loadState(url, webtracesPath);
      console.log('Errors without Privacy Badger = ' + originalState.errors.length);
      const expectedState = await utils.loadState(url, errorsPath);
      console.log('Errors with Privacy Badger =    ' + expectedState.errors.length);
      // console.log(await reproductionProxy.reproduceRequestState(expectedState, proxy));
      originalState.errors = expectedState.errors;
      proxy.requestState = originalState;
      const collectedState = await getState(url, 'localhost:' + proxy.port, path.join(__dirname, '../../privacy-badger/2020.8.25_0'));
      console.log('Errors after repair =           ' + collectedState.errors.length);
      if (savePath) {
        await stateCollector.serializeState(collectedState, savePath);
      }

      // add repair data to file
      const repairDataFile = path.join(__dirname, 'pb_stat/repairData.json');
      const urlRepairs = JSON.parse(JSON.stringify(repairOutput)); // do not use repairOutput directly because of race condition
      const u = url;
      fs.readFile(repairDataFile, (err, data) => {
        const repairsObj = err ? {} : JSON.parse(data); // err should only occur if file doesn't exist
        repairsObj[u] = urlRepairs;
        fs.writeFileSync(repairDataFile, JSON.stringify(repairsObj, null, 2));
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
  const webtracesPbRepairedDir = path.join(dataDir, 'repaired_webtraces_pb/');
  const urls = JSON.parse(fs.readFileSync(path.join(__dirname, 'pb_stat/reproducedUrls.json')));
  await repairUrls(urls, webtracesPbRepairedDir, path.join(dataDir, 'webtraces/'), webtracesPbDir);
  await utils.closeBrowser();
  process.exit(0);
})();
