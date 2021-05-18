const { stateCollector, reproductionProxy, utils } = require('DeadClick');
const fs = require('fs');
const path = require('path');

const webtracesDir = '../../data_sep_2020/randomDuckduckgoUrls/webtraces/';
const webtracesPbDir = path.join(webtracesDir, '../webtraces_pb/');
const md5s = fs.readdirSync(webtracesPbDir).filter(n => !n.includes('.'));

function cleanErrorMessage(errorMessage) {
  if (errorMessage.indexOf((" is not defined")) != -1) {
    return "XXX is not defined";
  } else if (errorMessage.indexOf(("Cannot read property ")) != -1) {
    return "Cannot read property XXX of null";
  } else if (errorMessage.indexOf((" is not a function")) != -1) {
    return "XXX is not a function";
  } else if (errorMessage.indexOf((" is not a constructor")) != -1) {
    return "XXX is not a constructor";
  } else if (errorMessage.indexOf(("Cannot set property ")) != -1) {
    return "Cannot set property XXX of null";
  } else if (errorMessage.indexOf(("Unexpected token ")) != -1 && errorMessage.indexOf("in JSON at position") != -1) {
    return "Unexpected token X in JSON at position Y";
  } else if (errorMessage.indexOf(("Unexpected token ")) != -1 ) {
    return "Unexpected token X";
  } else if (errorMessage.indexOf((" from accessing a cross-origin frame.")) != -1 ) {
    return "Blocked a frame with origin XXX from accessing a cross-origin frame.";
  } else if (errorMessage.indexOf(("Sys.ArgumentUndefinedException: Value cannot be undefined.")) != -1 ) {
    return "Sys.ArgumentUndefinedException: Value cannot be undefined.";
  } else if (errorMessage.indexOf("Loading chunk") != -1 && errorMessage.indexOf("failed.")) {
    return "Loading chunk XXX failed";
  } else if (errorMessage.indexOf("Script at url") != -1 && errorMessage.indexOf("failed to load")) {
    return "Script at url XXX failed to load";
  } else if (errorMessage.indexOf("Script error for") != -1) {
    return "Script error for XXX";
  } else if (errorMessage.indexOf("module already implemented") != -1) {
    return "module already implemented: XXX";
  } else if (errorMessage.indexOf(("remote script failed ")) != -1 ) {
    return "remote script failed XXX";
  } else if (errorMessage.indexOf(("etwork")) != -1 ) {
    return "Network error";
  } else if (errorMessage.indexOf(("Syntax error")) != -1 ) {
    return "Syntax error";
  } else if (errorMessage.indexOf(("adsbygoogle.push() error")) != -1 ) {
    return "adsbygoogle.push() error";
  }
  return errorMessage;
}

function extractAddedErrors(expectedErrors, errors) {
  const addedErrors = [];
  for (const error of errors) {
    if (!expectedErrors.map(e => e.getMessage()).includes(error.getMessage())) {
      addedErrors.push(error);
    }
  }
  return addedErrors;
}

async function compareAll(md5s) {
  const urls = [];
  const increasedErrorsAfterRepair = [];
  const errorsWithPbUrls = [];
  const errorsWithPb = [];
  const pbErrorUrls = [];
  const nonPbErrorUrls = [];
  const pbErrors = [];
  const nonPbErrors = [];
  const pbErrorMessages = {};
  const nonPbErrorMessages = {};
  const removedErrors = [];
  const removedErrorUrls = [];
  const urlsWithMoreErrors = [];
  const urlsWithLessErrors = [];
  const urlsWithSameErrorAmount = [];
  const errorCountUrlFreq = {};

  const promises = md5s.map(async md5 => {
    const expectedState = await utils.loadState(md5, webtracesDir);
    if (expectedState.reproduced && expectedState.reproduced.identical === false) {
      return;
    }
    const url = expectedState.url;
    const pbState = await utils.loadState(md5, webtracesPbDir);
    if (!pbState || pbState.requests[0].status >= 400) {
      return;
    } else {
      urls.push(url);
    }
    nonPbErrors.push(...expectedState.errors);
    if (expectedState.errors.length !== 0) {
      nonPbErrorUrls.push(url);
    }
    new Set(expectedState.errors.map(err => cleanErrorMessage(err.getMessage())))
      .forEach(errMsg => nonPbErrorMessages[errMsg] = nonPbErrorMessages[errMsg] + 1 || 1);
    
    errorsWithPb.push(...pbState.errors);
    if (pbState.errors.length != 0) {
      errorsWithPbUrls.push(url);
    }

    if (pbState.errors.length > expectedState.errors.length) {
      urlsWithMoreErrors.push(url);
    } else if (pbState.errors.length < expectedState.errors.length) {
      urlsWithLessErrors.push(url);
    } else {
      urlsWithSameErrorAmount.push(url);
    }
    const addedErrors = extractAddedErrors(expectedState.errors, pbState.errors);
    pbErrors.push(...addedErrors);
    if (addedErrors.length !== 0) {
      pbErrorUrls.push(url);
      errorCountUrlFreq[addedErrors.length] = errorCountUrlFreq[addedErrors.length] + 1 || 1;
    }
    const removedErrs = extractAddedErrors(pbState.errors, expectedState.errors);
    removedErrors.push(...removedErrs);
    if (removedErrs.length != 0) {
      removedErrorUrls.push(url);
    }
    new Set(addedErrors.map(err => cleanErrorMessage(err.getMessage())))
      .forEach(errMsg => pbErrorMessages[errMsg] = pbErrorMessages[errMsg] + 1 || 1);
  });
  await Promise.all(promises);

  console.log(`${urls.length} urls of which`);
  console.log(`${pbErrorUrls.length} suffer from ${pbErrors.length} errors caused by Privacy Badger`);
  console.log(`${urlsWithMoreErrors.length} urls have more errors when browsing with Privacy Badger`);
  console.log(`${urlsWithLessErrors.length} urls have less errors when browsing with Privacy Badger`);
  console.log(`${urlsWithSameErrorAmount.length} urls have the same amount of errors when browsing with Privacy Badger`);
  
  console.log(`${nonPbErrorUrls.length} urls suffer from ${nonPbErrors.length} errors when browsing without Privacy Badger`);
  console.log(`${errorsWithPbUrls.length} urls suffer from ${errorsWithPb.length} errors when browsing with Privacy Badger`);
  console.log(`${removedErrors.length} errors are removed from ${removedErrorUrls.length} urls when using PB.`);
  
  console.log('For each error count, how many urls have that error count?');
  console.log(errorCountUrlFreq);
  
  const sortedPbMessages = Object.fromEntries(Object.entries(pbErrorMessages).sort(([,a],[,b]) => b-a));
  const sortedNonPbMessages = Object.fromEntries(Object.entries(nonPbErrorMessages).sort(([,a],[,b]) => b-a));
  console.log('NON PB ERROR MESSAGES');
  console.log(sortedNonPbMessages);
  console.log('PB ERROR MESSAGES');
  console.log(sortedPbMessages);
}

(async () => {
  await compareAll(md5s);
})();
