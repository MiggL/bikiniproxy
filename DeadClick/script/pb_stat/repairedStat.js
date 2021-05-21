const { utils } = require('DeadClick');
const fs = require('fs');
const path = require('path');
const md5 = require('md5');

const improvedRepair = process.argv[2] == '2' || false;

const webtracesDir = path.join(__dirname, 'data_sep_2020/webtraces/');
const webtracesPbDir = path.join(webtracesDir, '../webtraces_pb/');
const webtracesPbRepairedDir = path.join(webtracesDir, `../repaired${improvedRepair?'2':''}_webtraces_pb/`);
const repairData = JSON.parse(fs.readFileSync(path.join(__dirname, `repairData.json`), 'utf8'));

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

async function compareAll(urls/*md5s*/) {
  const increasedErrorsAfterRepair = [];
  const pbErrors = [];
  const pbErrorUrls = [];
  const urlCountForPbErrorMessages = {};
  const healedPbErrorMessages = [];
  const healedUrls = [];
  const noRepairUrls = [];

  const urlsWithMoreErrors = [];
  const urlsWithLessErrors = [];
  const lessErrorsAfterPbRepair = [];
  const urlsWithSameErrorAmount = [];
  const urlCountForRepairedPbErrorMessages = {};

  const promises = urls.map(async url => {
    // get data from files
    const expectedState = await utils.loadState(url, webtracesDir);
    if (expectedState.reproduced && expectedState.reproduced.identical === false) {
      return;
    }

    // errors caused by Privacy Badger
    const pbState = await utils.loadState(url, webtracesPbDir);
    const pbErr = extractAddedErrors(expectedState.errors, pbState.errors);
    pbErrors.push(...pbErr);
    if (pbErr.length != 0) {
      pbErrorUrls.push(url);
    }
    new Set(pbErr.map(e => cleanErrorMessage(e.getMessage()))).forEach(msg => {
      if (urlCountForPbErrorMessages[msg]) {
        urlCountForPbErrorMessages[msg].push(url);
      } else {
        urlCountForPbErrorMessages[msg] = [url];
      }
      //urlCountForPbErrorMessages[msg] = urlCountForPbErrorMessages[msg] + 1 || 1;
    });

    // healed errors caused by Privacy Badger
    const repairedState = await utils.loadState(url, webtracesPbRepairedDir);
    if (!repairedState) {
      return;
    }
    pbErrAfterRepair = extractAddedErrors(expectedState.errors, repairedState.errors);
    const urlRepairs = repairData[url];
    const repairedPbErrorMessages = [];
    const urlRepairedPbErrorMessages = new Set();
    let targetedPbErrors = false;
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
        if (targetedPbErrors) {
          lessErrorsAfterPbRepair.push(url);
        }
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
  console.log(`Stats on ${pbErrors.length} errors caused by Privacy Badger on ${pbErrorUrls.length} urls.`);
  // Don't print stats for all pb error messages, only print stats for the types that were repaired.
  const urlCountForPbErrorMessagesShort = {};
  const pbErrMsgCount = {};
  const urlsForPrintedMsgs = new Set();
  Object.keys(urlCountForRepairedPbErrorMessages).forEach(msg => {
    urlCountForPbErrorMessagesShort[msg] = urlCountForPbErrorMessages[msg].length;
    pbErrMsgCount[msg] = pbErrors.filter(e => cleanErrorMessage(e.getMessage()) == msg).length;
    urlCountForPbErrorMessages[msg].forEach(url => urlsForPrintedMsgs.add(url));
  });
  console.log('url count for error types caused by Privacy Badger (only repairable types):');
  console.log(urlCountForPbErrorMessagesShort)
  console.log('total urls with these error messages:', urlsForPrintedMsgs.size);
  console.log('Errors caused by Privacy Badger (only repairable types):');
  console.log(pbErrMsgCount);

  console.log('url count for repaired PB error messages:');
  console.log(urlCountForRepairedPbErrorMessages);
  console.log('Healed urls:', healedUrls.length);

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

  console.log(`${lessErrorsAfterPbRepair.length} urls have less errors after repairing errors caused by Privacy Badger`);
  //fs.writeFileSync(`lessErrorsAfterPbRepair${improvedRepair?'2':''}.json`, JSON.stringify(lessErrorsAfterPbRepair, null, 2));
}

(async () => {
  const urls = Object.keys(repairData);
  await compareAll(urls);
})();
