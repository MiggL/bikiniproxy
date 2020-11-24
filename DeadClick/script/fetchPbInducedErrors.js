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

function deleteUrlWebtraces(url, webtracesDir) {
  const directory = path.join(webtracesDir, md5(url));
  fs.readdir(directory, (err, files) => {
    if (err) throw err;
    files.forEach(file => file === 'request.json' || file === 'screenshot.png' || fs.unlinkSync(path.join(directory, file)));
    // fs.rmdirSync(directory);
  });
}

function addToJsonArrayFile(jsonObj, filepath) {
  const dir = filepath.slice(0, filepath.lastIndexOf('/'));
  if (!fs.existsSync(dir)){
    fs.mkdirSync(dir);
  }
  fs.readFile(filepath, (err, data) => {
    try {
      const contentArray = err ? [] : JSON.parse(data); // err should only occur if file doesn't exist
      if (!contentArray.map(JSON.stringify).includes(JSON.stringify(jsonObj))) {
        contentArray.push(jsonObj);
        fs.writeFileSync(filepath, JSON.stringify(contentArray, null, 2));
      }
    } catch (e) {
      addToJsonArrayFile(jsonObj, filepath);
    }
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
      addToJsonArrayFile(url, path.join(fromWebDataDir, 'collected.json'));
    } catch (e) {
      console.error(e);
      await utils.closeBrowser();
      addToJsonArrayFile(url, path.join(fromWebDataDir, 'notCollected.json'));
      continue;
    }
    try {
      console.log('reproducing');
      const expectedState = await utils.loadState(url, webtracesDir); // maybe fetch from proxy for consistency?
      const isReproduced = await reproductionProxy.reproduceRequestState(expectedState, proxy);
      console.log(isReproduced.identical);
      if (isReproduced.identical === true) {
        addToJsonArrayFile(url, path.join(fromWebDataDir, 'reproduced.json'));
      } else {
        addToJsonArrayFile(url, path.join(fromWebDataDir, 'notReproduced.json'));
        deleteUrlWebtraces(url, webtracesDir);
        continue;
      }
    } catch (e) {
      console.error(e);
      await utils.closeBrowser();
      addToJsonArrayFile(url, path.join(fromWebDataDir, 'errorReproducing.json'));
      deleteUrlWebtraces(url, webtracesDir);
      continue;
    }
  }
}

async function trainPb(urls, webtracesDir = utils.requestsPath, proxy) {
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

  await trainPb(urls, webtracesDir, proxy);

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log('\nExtracting PB errors ' + (i + 1) + '/' + urls.length);
    console.log(url);
    const expectedState = await utils.loadState(url, webtracesDir);
    try {
      proxy.requestState = expectedState;
      const collectedPbState = await getState(url, 'localhost:' + proxy.port, path.join(__dirname, '../../privacy-badger/2020.8.25_0'));
      console.log(collectedPbState.errors.map(e => e.exceptionDetails.exception.description));
      await stateCollector.serializeState(collectedPbState, webtracesPbDir);
      addToJsonArrayFile(url, path.join(fromProxyDataDir, 'pbCollected.json'));
    } catch (e) {
      console.error(e);
      addToJsonArrayFile(url, path.join(fromProxyDataDir, 'notPbCollected.json'));
      deleteUrlWebtraces(url, webtracesDir);
      continue;
    }
    const pbState = await utils.loadState(url, webtracesPbDir);
    const pbErrors = extractAddedErrors(expectedState.errors, pbState.errors);
    if (pbErrors.length === 0) {
      deleteUrlWebtraces(url, webtracesDir);
      deleteUrlWebtraces(url, webtracesPbDir);
    }
    addToJsonArrayFile({ url: url, addedPbErrors: pbErrors }, path.join(fromProxyDataDir, 'addedPbErrors.json'));
  }
  proxy.close();
}

(async () => {
  const webtracesDir = path.join(__dirname, '../data_sep_2020/randomDuckduckgoUrls/webtraces/');
  const webtracesPbDir = path.join(webtracesDir, '../webtraces_pb_repaired_new/');
  await collectUrls(urls, webtracesDir);
  await utils.closeBrowser();
  await extractPbErrors(urls, webtracesDir, webtracesPbDir);
  await utils.closeBrowser();
  process.exit(0);
})();
