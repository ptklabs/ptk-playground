
const logEl = () => document.getElementById('client-log');

function appendLog(message) {
  const el = logEl();
  if (!el) return;
  const time = new Date().toISOString().slice(11, 19);
  el.textContent = `[${time}] ${message}`;
}

// Simple WebSQL mimic
if (!window.tx) {
  window.tx = {
    executeSql(query, params, onSuccess, onError) {
      appendLog(`executeSql → ${query} | params=${JSON.stringify(params || [])}`);
      try {
        if (typeof onSuccess === "function") onSuccess({ rowsAffected: 0 });
      } catch (err) {
        if (typeof onError === "function") onError(err);
      }
    }
  };
}

window.onSqlError = function (err) {
  appendLog(`SQL Error: ${err && err.message ? err.message : err}`);
};

window.escapeXPath = window.escapeXPath || function (value) {
  if (value == null) return "''";
  const str = String(value);
  if (!/[\'"]/.test(str)) return "'" + str + "'";
  return "concat('" + str.replace(/'/g, "',\"'\",'") + "')";
};

window.parseJsonWithEval = window.parseJsonWithEval || function (str) {
  return eval('(' + str + ')');
};

function runTaintedSql() {
  const input = document.getElementById('sqlNameInput')?.value || '';
  if (input) {
    window.location.hash = encodeURIComponent(input);
  }
  const name = location.hash ? decodeURIComponent(location.hash.slice(1)) : '';
  tx.executeSql("SELECT * FROM users WHERE name='" + name + "'", [], function () { }, onSqlError);
}


function runJsonEval() {
  const payload = document.getElementById('jsonPayloadInput')?.value || '{}';
  try {
    const obj = parseJsonWithEval(payload);
    appendLog("eval() parsed object: " + JSON.stringify(obj));
  } catch (err) {
    appendLog("eval() threw " + err);
  }
}


function runXPathTaint() {
  const raw = document.getElementById('xpathInput')?.value || '';
  const expr = "//user[name='" + raw + "']";
  document.evaluate(expr, document, null, XPathResult.ANY_TYPE, null);
  appendLog("Executed tainted XPath → " + expr);
}


