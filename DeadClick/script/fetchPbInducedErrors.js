const { stateCollector, reproductionProxy, utils } = require('DeadClick');
const fs = require('fs');
const path = require('path');
const md5 = require('md5');

function getState(url, proxyUrl = null, extension = null) {
  return stateCollector.collectPage({
    url: url,
    proxy: proxyUrl,
    collectScreenShot: true,
    extension: extension,
    timeout:25000
  });
}

function extractAddedErrors(expectedErrors, errors) {
  const addedErrors = [];
  for (const error of errors) {
    if (!expectedErrors.map(utils.getErrorMessage).includes(utils.getErrorMessage(error))) {
      addedErrors.push(error);
    }
  }
  return addedErrors;
}

async function collectUrls(urls, webtracesDir = utils.requestsPath) {
  const fromWebDataDir = path.join(webtracesDir, '../from_web_data/');
  if (!fs.existsSync(fromWebDataDir)){
    fs.mkdirSync(fromWebDataDir);
  }
  const proxy = await reproductionProxy.startReproductionProxy(8001, webtracesDir);

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log('\nCollecting ' + (i + 1) + '/' + urls.length);
    console.log(url);
    try {
      const collectedState = await getState(url);
      await stateCollector.serializeState(collectedState, webtracesDir);
    } catch (e) {
      console.error(e);
      continue;
    } finally {
      await utils.closeBrowser();
    }
    try {
      console.log('reproducing');
      const expectedState = await utils.loadState(url, webtracesDir);
      const { identical, type, actual } = await reproductionProxy.reproduceRequestState(expectedState, proxy);
      for (let j = 0; j < actual.requests.length; j++) {
        delete actual.requests[j].body;
      }
      console.log(identical);
      expectedState.reproduced = identical ? { identical } : { identical, type, actual };
      fs.writeFileSync(path.join(webtracesDir, md5(url), 'request.json'), JSON.stringify(expectedState));
    } catch (e) {
      console.error(e);
    } finally {
      await utils.closeBrowser();
    }
  }
}

async function trainPb(urls, webtracesDir = utils.requestsPath, proxy) {
  // If needed, uncomment and use time to manually import training data.
  /*const expectedState = await utils.loadState(urls[0], webtracesDir);
  proxy.requestState = expectedState;
  await getState(urls[0], 'localhost:' + proxy.port, path.join(__dirname, '../../privacy-badger/2020.8.25_0'));
  proxy.requestState = await utils.loadState(urls[4269], webtracesDir);
  await getState(urls[0], 'localhost:' + proxy.port, path.join(__dirname, '../../privacy-badger/2020.8.25_0'));
  */
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log('\nVisiting ' + (i + 1) + '/' + urls.length);
    console.log(url);
    const expectedState = await utils.loadState(url, webtracesDir);
    try {
      proxy.requestState = expectedState;
      await getState(url, 'localhost:' + proxy.port, path.join(__dirname, '../../privacy-badger/2020.8.25_0'));
    } catch (e) {
      console.error(e);
      continue;
    }
  }
}

async function extractPbErrors(urls, webtracesDir = utils.requestsPath, webtracesPbDir = path.join(utils.requestsPath, '../webtraces_pb/')) {
  const fromProxyDataDir = path.join(webtracesDir, '../from_proxy_data/');
  if (!fs.existsSync(fromProxyDataDir)){
    fs.mkdirSync(fromProxyDataDir);
  }
  const proxy = await reproductionProxy.startReproductionProxy(8002, webtracesDir);

  // No need to train new versions of Privacy Badger.
  await trainPb(urls, webtracesDir, proxy);

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log('\nExtracting PB errors ' + (i + 1) + '/' + urls.length);
    console.log(url);
    const expectedState = await utils.loadState(url, webtracesDir);
    try {
      proxy.requestState = expectedState;
      const collectedPbState = await getState(url, 'localhost:' + proxy.port, path.join(__dirname, '../../privacy-badger/2020.8.25_0'));
      //console.log(collectedPbState.errors.map(e => e.exceptionDetails.exception.description));
      await stateCollector.serializeState(collectedPbState, webtracesPbDir);
    } catch (e) {
      console.error(e);
      continue;
    }
  }
  proxy.close();
}

(async () => {
  const webtracesDir = path.join(__dirname, '../data_sep_2020/randomDuckduckgoUrls/webtraces/');
  const webtracesPbDir = path.join(webtracesDir, '../webtraces_pb/');
  const urls = JSON.parse(fs.readFileSync(path.join(__dirname, 'collectedDuckduckgoUrls.json')));
  await collectUrls(urls, webtracesDir);
  await utils.closeBrowser();
  await extractPbErrors(urls, webtracesDir, webtracesPbDir);
  //await utils.closeBrowser();
  //process.exit(0);
})();
