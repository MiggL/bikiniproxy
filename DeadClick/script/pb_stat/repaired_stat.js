const { utils } = require('DeadClick');
const fs = require('fs');
const path = require('path');
const md5 = require('md5');

const webtracesDir = '../../data_sep_2020/randomDuckduckgoUrls/webtraces/';
const webtracesPbDir = path.join(webtracesDir, '../webtraces_pb/');
const webtracesPbRepairedDir = path.join(webtracesDir, '../webtraces_pb_repaired/');
const webtracesPbRepairedNewDir = path.join(webtracesDir, '../webtraces_pb_repaired_new_2_7/');
const repairData = JSON.parse(fs.readFileSync(path.join(webtracesDir, '../from_proxy_data/repairData.json'), 'utf8'));

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
  }
  return errorMessage;//.replace(/\'?\"?https?:\/\/[^\s]+/g, "XXX");
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

async function compareAll(urls/*md5s*/) {
  const notPassedUrls = [];
  const repairTimeout = [];

  const increasedErrorsAfterRepair = [];
  const pbErrors = [];
  const pbErrorUrls = [];
  const healedPbErrorMessages = [];
  const healedUrls = [];
  const noRepairUrls = [];

  const urlsWithMoreErrors = [];
  const urlsWithLessErrors = [];
  const urlsWithSameErrorAmount = [];
  const urlCountForRepairedPbErrorMessages = {};

  //const promises = md5s.map(async md5 => {
  const promises = urls.map(async url => {
    // get data from files
    const expectedState = await utils.loadState(url/*md5*/, webtracesDir);
    //const url = expectedState.url;
    if (expectedState.reproduced && expectedState.reproduced.identical === false) {
      return;
    }
    const repairedState = await utils.loadState(url, webtracesPbRepairedDir);
    if (!repairedState) {
      notPassedUrls.push(url);
      return;
    }

    // errors caused by Privacy Badger
    const pbState = await utils.loadState(url, webtracesPbDir);
    const pbErr = extractAddedErrors(expectedState.errors, pbState.errors);
    pbErrors.push(...pbErr);
    if (pbErr.length != 0) {
      pbErrorUrls.push(url);
    }

    // healed errors caused by Privacy Badger
    pbErrAfterRepair = extractAddedErrors(expectedState.errors, repairedState.errors);
    const urlRepairs = repairData.filter(rd => rd.url === url)[0].repairs;
    const repairedPbErrorMessages = [];
    const urlRepairedPbErrorMessages = new Set();
    urlRepairs.forEach(({ error }) => {
      samePbErrs = pbErr.filter(pbE => error.timestamp === pbE.timestamp && error.exceptionDetails.exceptionId === pbE.exceptionDetails.exceptionId);
      if (samePbErrs.length == 0) return;
      targetedPbErrors = true;
      const msg = samePbErrs[0].getMessage();
      const removedErrorsOfMsg = pbErr.filter(e => e.getMessage() == msg).length - pbErrAfterRepair.filter(e => e.getMessage() == msg).length;
      if (removedErrorsOfMsg > 0) {
        urlRepairedPbErrorMessages.add(cleanErrorMessage(msg));
        if (!repairedPbErrorMessages.includes(msg)) {
          repairedPbErrorMessages.push(...Array(removedErrorsOfMsg).fill(msg));
        }
      }
    });
    if (repairedPbErrorMessages.length != 0) healedUrls.push(url);
    if (urlRepairs.length != 0) {
      if (repairedState.errors.length > pbState.errors.length) {
        urlsWithMoreErrors.push(url);
      } else if (repairedState.errors.length < pbState.errors.length) {
        urlsWithLessErrors.push(url);
      } else {
        urlsWithSameErrorAmount.push(url);
      }
    }
    healedPbErrorMessages.push(...repairedPbErrorMessages.map(cleanErrorMessage));
    urlRepairedPbErrorMessages.forEach(msg => {
      urlCountForRepairedPbErrorMessages[msg] = urlCountForRepairedPbErrorMessages[msg] + 1 || 1;
    });
  });
  await Promise.all(promises);

  console.log('urlCountForRepairedPbErrorMessages:');
  console.log(urlCountForRepairedPbErrorMessages);
  console.log('Healed urls:', healedUrls.length);
  //console.log(healedUrls.map(url => [url, md5(url)]));

  const healedPbErrMsgStats = {};
  for (const msg of new Set(healedPbErrorMessages)) {
    healedPbErrMsgStats[msg] = healedPbErrorMessages.filter(m => m == msg).length
  }
  console.log('\nhealedPbErrMsgStats:');
  console.log(healedPbErrMsgStats);
  console.log('Healed errors:', healedPbErrorMessages.length);
  
  console.log(`\n${urlsWithMoreErrors.length} urls have more errors after repair when browsing with Privacy Badger`);
  console.log(`${urlsWithLessErrors.length} urls have less errors after repair when browsing with Privacy Badger`);
  console.log(`${urlsWithSameErrorAmount.length} urls have the same amount of errors after repair when browsing with Privacy Badger`);
}

(async () => {
  const urls = repairData.filter(rd => rd.repairs.length != 0).map(rd => rd.url);
  //const md5s = fs.readdirSync(webtracesPbRepairedDir);
  await compareAll(urls);
})();
