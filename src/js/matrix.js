'use strict';

µMatrix.Matrix = (function() {
var µm = µMatrix;
var selfieVersion = 1;

var Matrix = function() {
    this.reset();
    this.sourceRegister = '';
    this.decomposedSourceRegister = [''];
    this.specificityRegister = 0;
};

Matrix.Transparent = 0;
Matrix.Red = 1;
Matrix.Green = 2;
Matrix.Gray = 3;

Matrix.Indirect = 0x00;
Matrix.Direct = 0x80;

Matrix.RedDirect = Matrix.Red | Matrix.Direct;
Matrix.RedIndirect = Matrix.Red | Matrix.Indirect;
Matrix.GreenDirect = Matrix.Green | Matrix.Direct;
Matrix.GreenIndirect = Matrix.Green | Matrix.Indirect;
Matrix.GrayDirect = Matrix.Gray | Matrix.Direct;
Matrix.GrayIndirect = Matrix.Gray | Matrix.Indirect;

var typeBitOffsets = new Map([
    ['*', 0],
    ['doc', 2],
    ['cookie', 4],
    ['css', 6],
    ['image', 8],
    ['media', 10],
    ['script', 12],
    ['xhr', 14],
    ['frame', 16],
    ['other', 18]
]);

var stateToNameMap = new Map([
    [1, 'block'],
    [2, 'allow'],
    [3, 'inherit']
]);

var nameToStateMap = {
      'block': 1,
      'allow': 2,
       'noop': 2,
    'inherit': 3
};

var switchBitOffsets = new Map([
    ['matrix-off', 0],
    ['https-strict', 2],
    ['referrer-spoof', 6],
    ['noscript-spoof', 8],
    ['no-workers', 10]
]);

var switchStateToNameMap = new Map([
    [1, 'true'],
    [2, 'false']
]);

var nameToSwitchStateMap = new Map([
    ['true', 1],
    ['false', 2]
]);

Matrix.columnHeaderIndices = (function() {
    var out = new Map(),
        i = 0;
    for ( var type of typeBitOffsets.keys() ) {
        out.set(type, i++);
    }
    return out;
})();

Matrix.switchNames = new Set(switchBitOffsets.keys());

var reHostnameVeryCoarse = /[g-z_-]/;
var reIPv4VeryCoarse = /\.\d+$/;

var isIPAddress = function(hostname) {
    if ( reHostnameVeryCoarse.test(hostname) ) {
        return false;
    }
    if ( reIPv4VeryCoarse.test(hostname) ) {
        return true;
    }
    return hostname.charAt(0) === '[';
};

var punycodeIf = function(hn) {
    return reNotASCII.test(hn) ? punycode.toASCII(hn) : hn;
};

var unpunycodeIf = function(hn) {
    return hn.indexOf('xn--') !== -1 ? punycode.toUnicode(hn) : hn;
};

var reNotASCII = /[^\x20-\x7F]/;

var toBroaderHostname = function(hostname) {
    if ( hostname === '*' ) { return ''; }
    if ( isIPAddress(hostname) ) {
        return toBroaderIPAddress(hostname);
    }
    var pos = hostname.indexOf('.');
    if ( pos === -1 ) {
        return '*';
    }
    return hostname.slice(pos + 1);
};

var toBroaderIPAddress = function(ipaddress) {
    if ( ipaddress.charAt(0) === '[' ) {
        return '*';
    }
    var pos = ipaddress.lastIndexOf('.');
    return pos !== -1 ? ipaddress.slice(0, pos) : '*';
};

Matrix.toBroaderHostname = toBroaderHostname;

var extractFirstPartyDesDomain = function(srcHostname, desHostname) {
    if ( srcHostname === '*' || desHostname === '*' || desHostname === '1st-party' ) {
        return '';
    }
    var µmuri = µm.URI;
    var srcDomain = µmuri.domainFromHostname(srcHostname) || srcHostname;
    var desDomain = µmuri.domainFromHostname(desHostname) || desHostname;
    return desDomain === srcDomain ? desDomain : '';
};

Matrix.prototype.reset = function() {
    this.switches = new Map();
    this.rules = new Map();
    this.rootValue = Matrix.RedIndirect;
    this.modifiedTime = 0;
    if ( this.modifyEventTimer !== undefined ) {
        clearTimeout(this.modifyEventTimer);
    }
    this.modifyEventTimer = undefined;
    this.modified();
};

Matrix.prototype.modified = function() {
    this.modifiedTime = Date.now();
    if ( this.modifyEventTimer !== undefined ) { return; }
    this.modifyEventTimer = vAPI.setTimeout(
        ( ) => {
            this.modifyEventTimer = undefined;
            window.dispatchEvent(
                new CustomEvent(
                    'matrixRulesetChange',
                    { detail: this }
                )
            );
        },
        149
    );
};

Matrix.prototype.decomposeSource = function(srcHostname) {
    if ( srcHostname === this.sourceRegister ) { return; }
    var hn = srcHostname;
    this.decomposedSourceRegister[0] = this.sourceRegister = hn;
    var i = 1;
    for (;;) {
        hn = toBroaderHostname(hn);
        this.decomposedSourceRegister[i++] = hn;
        if ( hn === '' ) { break; }
    }
};

Matrix.prototype.assign = function(other) {
    var k, entry;
    for ( k of this.rules.keys() ) {
        if ( other.rules.has(k) === false ) {
            this.rules.delete(k);
        }
    }
    for ( k of this.switches.keys() ) {
        if ( other.switches.has(k) === false ) {
            this.switches.delete(k);
        }
    }
    for ( entry of other.rules ) {
        this.rules.set(entry[0], entry[1]);
    }
    for ( entry of other.switches ) {
        this.switches.set(entry[0], entry[1]);
    }
    this.modified();
    return this;
};

Matrix.prototype.setSwitch = function(switchName, srcHostname, newVal) {
    var bitOffset = switchBitOffsets.get(switchName);
    if ( bitOffset === undefined ) {
        return false;
    }
    if ( newVal === this.evaluateSwitch(switchName, srcHostname) ) {
        return false;
    }
    var bits = this.switches.get(srcHostname) || 0;
    bits &= ~(3 << bitOffset);
    bits |= newVal << bitOffset;
    if ( bits === 0 ) {
        this.switches.delete(srcHostname);
    } else {
        this.switches.set(srcHostname, bits);
    }
    this.modified();
    return true;
};

Matrix.prototype.setCell = function(srcHostname, desHostname, type, state) {
    var bitOffset = typeBitOffsets.get(type),
        k = srcHostname + ' ' + desHostname,
        oldBitmap = this.rules.get(k);
    if ( oldBitmap === undefined ) {
        oldBitmap = 0;
    }
    var newBitmap = oldBitmap & ~(3 << bitOffset) | (state << bitOffset);
    if ( newBitmap === oldBitmap ) {
        return false;
    }
    if ( newBitmap === 0 ) {
        this.rules.delete(k);
    } else {
        this.rules.set(k, newBitmap);
    }
    this.modified();
    return true;
};

Matrix.prototype.blacklistCell = function(srcHostname, desHostname, type) {
    var r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 1 ) {
        return false;
    }
    this.setCell(srcHostname, desHostname, type, 0);
    r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 1 ) {
        return true;
    }
    this.setCell(srcHostname, desHostname, type, 1);
    return true;
};

Matrix.prototype.whitelistCell = function(srcHostname, desHostname, type) {
    var r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 2 ) {
        return false;
    }
    this.setCell(srcHostname, desHostname, type, 0);
    r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 2 ) {
        return true;
    }
    this.setCell(srcHostname, desHostname, type, 2);
    return true;
};

Matrix.prototype.graylistCell = function(srcHostname, desHostname, type) {
    var r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 0 || r === 3 ) {
        return false;
    }
    this.setCell(srcHostname, desHostname, type, 0);
    r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 0 || r === 3 ) {
        return true;
    }
    this.setCell(srcHostname, desHostname, type, 3);
    return true;
};

Matrix.prototype.evaluateCell = function(srcHostname, desHostname, type) {
    var key = srcHostname + ' ' + desHostname;
    var bitmap = this.rules.get(key);
    if ( bitmap === undefined ) {
        return 0;
    }
    return bitmap >> typeBitOffsets.get(type) & 3;
};

Matrix.prototype.evaluateCellZ = function(srcHostname, desHostname, type) {
    this.decomposeSource(srcHostname);

    var bitOffset = typeBitOffsets.get(type),
        s, v, i = 0;
    for (;;) {
        s = this.decomposedSourceRegister[i++];
        if ( s === '' ) { break; }
        v = this.rules.get(s + ' ' + desHostname);
        if ( v !== undefined ) {
            v = v >> bitOffset & 3;
            if ( v !== 0 ) {
                return v;
            }
        }
    }

    if ( type === '*' && µm.ubiquitousBlacklist.test(desHostname) ) {
        return 1;
    }

    if ( type === 'doc' && desHostname === '*' ) {
        return 2;
    }

    return 0;
};

Matrix.prototype.evaluateCellZXY = function(srcHostname, desHostname, type) {
    this.specificityRegister = 0;
    if ( this.evaluateSwitchZ('matrix-off', srcHostname) ) {
        return Matrix.GreenIndirect;
    }

    this.specificityRegister = 1;
    var r = this.evaluateCellZ(srcHostname, desHostname, type);
    if ( r === 1 ) { return Matrix.RedDirect; }
    if ( r === 2 ) { return Matrix.GreenDirect; }

    this.specificityRegister = 2;
    var rl = this.evaluateCellZ(srcHostname, desHostname, '*');
    if ( rl === 1 ) { return Matrix.RedIndirect; }

    var d = desHostname;
    var firstPartyDesDomain = extractFirstPartyDesDomain(srcHostname, desHostname);

    if ( firstPartyDesDomain !== '' ) {
        this.specificityRegister = 3;
        for (;;) {
            if ( d === firstPartyDesDomain ) { break; }
            d = d.slice(d.indexOf('.') + 1);

            r = this.evaluateCellZ(srcHostname, d, type);
            if ( r === 1 ) { return Matrix.RedIndirect; }
            if ( r === 2 ) { return Matrix.GreenIndirect; }
            if ( rl !== 2 ) {
                rl = this.evaluateCellZ(srcHostname, d, '*');
                if ( rl === 1 ) { return Matrix.RedIndirect; }
            }
        }

        r = this.evaluateCellZ(srcHostname, '1st-party', type);
        if ( r === 1 ) { return Matrix.RedIndirect; }
        if ( r === 2 ) { return Matrix.GreenIndirect; }
        if ( rl !== 2 ) {
            rl = this.evaluateCellZ(srcHostname, '1st-party', '*');
            if ( rl === 1 ) { return Matrix.RedIndirect; }
        }
    }

    this.specificityRegister = 4;
    for (;;) {
        d = toBroaderHostname(d);
        if ( d === '*' ) { break; }

        r = this.evaluateCellZ(srcHostname, d, type);
        if ( r === 1 ) { return Matrix.RedIndirect; }
        if ( r === 2 ) { return Matrix.GreenIndirect; }
        if ( rl !== 2 ) {
            rl = this.evaluateCellZ(srcHostname, d, '*');
            if ( rl === 1 ) { return Matrix.RedIndirect; }
        }
    }

    this.specificityRegister = 5;
    r = this.evaluateCellZ(srcHostname, '*', type);
    if ( r === 1 ) { return Matrix.RedIndirect; }
    if ( rl === 2 ) { return Matrix.GreenIndirect; }
    if ( r === 2 ) { return Matrix.GreenIndirect; }

    this.specificityRegister = 6;
    r = this.evaluateCellZ(srcHostname, '*', '*');
    if ( r === 1 ) { return Matrix.RedIndirect; }
    if ( r === 2 ) { return Matrix.GreenIndirect; }
    return this.rootValue;
};

Matrix.prototype.evaluateRowZXY = function(srcHostname, desHostname) {
    let out = [];
    for ( let type of typeBitOffsets.keys() ) {
        out.push(this.evaluateCellZXY(srcHostname, desHostname, type));
    }
    return out;
};

Matrix.prototype.mustBlock = function(srcHostname, desHostname, type) {
    return (this.evaluateCellZXY(srcHostname, desHostname, type) & 3) === Matrix.Red;
};

Matrix.prototype.srcHostnameFromRule = function(rule) {
    return rule.slice(0, rule.indexOf(' '));
};

Matrix.prototype.desHostnameFromRule = function(rule) {
    return rule.slice(rule.indexOf(' ') + 1);
};

Matrix.prototype.setSwitchZ = function(switchName, srcHostname, newState) {
    var bitOffset = switchBitOffsets.get(switchName);
    if ( bitOffset === undefined ) {
        return false;
    }
    var state = this.evaluateSwitchZ(switchName, srcHostname);
    if ( newState === state ) {
        return false;
    }
    if ( newState === undefined ) {
        newState = !state;
    }
    var bits = this.switches.get(srcHostname) || 0;
    bits &= ~(3 << bitOffset);
    if ( bits === 0 ) {
        this.switches.delete(srcHostname);
    } else {
        this.switches.set(srcHostname, bits);
    }
    this.modified();
    state = this.evaluateSwitchZ(switchName, srcHostname);
    if ( state === newState ) {
        return true;
    }
    this.switches.set(srcHostname, bits | ((newState ? 1 : 2) << bitOffset));
    return true;
};

Matrix.prototype.evaluateSwitch = function(switchName, srcHostname) {
    var bits = this.switches.get(srcHostname) || 0;
    if ( bits === 0 ) {
        return 0;
    }
    var bitOffset = switchBitOffsets.get(switchName);
    if ( bitOffset === undefined ) {
        return 0;
    }
    return (bits >> bitOffset) & 3;
};

Matrix.prototype.evaluateSwitchZ = function(switchName, srcHostname) {
    var bitOffset = switchBitOffsets.get(switchName);
    if ( bitOffset === undefined ) { return false; }

    this.decomposeSource(srcHostname);

    var s, bits, i = 0;
    for (;;) {
        s = this.decomposedSourceRegister[i++];
        if ( s === '' ) { break; }
        bits = this.switches.get(s) || 0;
        if ( bits !== 0 ) {
            bits = bits >> bitOffset & 3;
            if ( bits !== 0 ) {
                return bits === 1;
            }
        }
    }
    return false;
};

Matrix.prototype.extractAllSourceHostnames = (function() {
    var cachedResult = new Set();
    var matrixId = 0;
    var readTime = 0;

    return function() {
        if ( matrixId !== this.id || readTime !== this.modifiedTime ) {
            cachedResult.clear();
            for ( var rule of this.rules.keys() ) {
                cachedResult.add(rule.slice(0, rule.indexOf(' ')));
            }
            matrixId = this.id;
            readTime = this.modifiedTime;
        }
        return cachedResult;
    };
})();

Matrix.prototype.partsFromLine = function(line) {
    let fields = line.split(/\s+/);
    if ( fields.length < 3 ) { return; }

    if ( this.reSwitchRule.test(fields[0]) ) {
        fields[0] = fields[0].slice(0, -1);
        if ( switchBitOffsets.has(fields[0]) === false ) { return; }
        fields[1] = punycodeIf(fields[1]);
        fields[2] = nameToSwitchStateMap.get(fields[2]);
        if ( fields[2] === undefined ) { return; }
        fields.length = 3;
        return fields;
    }

    if ( fields.length < 4 ) { return; }
    fields[0] = punycodeIf(fields[0]);
    fields[1] = punycodeIf(fields[1]);
    if ( fields[2] === 'plugin' ) { fields[2] = 'media'; }
    if ( typeBitOffsets.get(fields[2]) === undefined ) { return; }
    if ( nameToStateMap.hasOwnProperty(fields[3]) === false ) { return; }
    fields[3] = nameToStateMap[fields[3]];
    fields.length = 4;
    return fields;
};

Matrix.prototype.reSwitchRule = /^[0-9a-z-]+:$/;

Matrix.prototype.fromArray = function(lines, append) {
    let matrix = append === true ? this : new Matrix();
    for ( let line of lines ) {
        matrix.addFromLine(line);
    }
    if ( append !== true ) {
        this.assign(matrix);
    }
    this.modified();
};

Matrix.prototype.toArray = function() {
    let out = [];
    for ( let rule of this.rules.keys() ) {
        let srcHostname = this.srcHostnameFromRule(rule);
        let desHostname = this.desHostnameFromRule(rule);
        for ( let type of typeBitOffsets.keys() ) {
            let val = this.evaluateCell(srcHostname, desHostname, type);
            if ( val === 0 ) { continue; }
            out.push(
                unpunycodeIf(srcHostname) + ' ' +
                unpunycodeIf(desHostname) + ' ' +
                type + ' ' +
                stateToNameMap.get(val)
            );
        }
    }
    for ( let srcHostname of this.switches.keys() ) {
        for ( let switchName of switchBitOffsets.keys() ) {
            let val = this.evaluateSwitch(switchName, srcHostname);
            if ( val === 0 ) { continue; }
            out.push(
                switchName + ': ' +
                srcHostname + ' ' +
                switchStateToNameMap.get(val)
            );
        }
    }
    return out;
};

Matrix.prototype.fromString = function(text, append) {
    let matrix = append === true ? this : new Matrix();
    let textEnd = text.length;
    let lineBeg = 0;

    while ( lineBeg < textEnd ) {
        let lineEnd = text.indexOf('\n', lineBeg);
        if ( lineEnd === -1 ) {
            lineEnd = text.indexOf('\r', lineBeg);
            if ( lineEnd === -1 ) {
                lineEnd = textEnd;
            }
        }
        let line = text.slice(lineBeg, lineEnd).trim();
        lineBeg = lineEnd + 1;
        let pos = line.indexOf('# ');
        if ( pos !== -1 ) {
            line = line.slice(0, pos).trim();
        }
        if ( line === '' ) { continue; }
        matrix.addFromLine(line);
    }

    if ( append !== true ) {
        this.assign(matrix);
    }

    this.modified();
};

Matrix.prototype.toString = function() {
    return this.toArray().join('\n');
};

Matrix.prototype.addFromLine = function(line) {
    let fields = this.partsFromLine(line);
    if ( fields !== undefined ) {
        if ( fields.length === 3 ) {
            return this.setSwitch(fields[0], fields[1], fields[2]);
        }
        if ( fields.length === 4 ) {
            return this.setCell(fields[0], fields[1], fields[2], fields[3]);
        }
    }
};

Matrix.prototype.removeFromLine = function(line) {
    let fields = this.partsFromLine(line);
    if ( fields !== undefined ) {
        if ( fields.length === 3 ) {
            return this.setSwitch(fields[0], fields[1], 0);
        }
        if ( fields.length === 4 ) {
            return this.setCell(fields[0], fields[1], fields[2], 0);
        }
    }
};

Matrix.prototype.fromSelfie = function(selfie) {
    if ( selfie.version !== selfieVersion ) { return false; }
    this.switches = new Map(selfie.switches);
    this.rules = new Map(selfie.rules);
    this.modified();
    return true;
};

Matrix.prototype.toSelfie = function() {
    return {
        version: selfieVersion,
        switches: Array.from(this.switches),
        rules: Array.from(this.rules)
    };
};

Matrix.prototype.diff = function(other, srcHostname, desHostnames) {
    var out = [];
    var desHostname, type;
    var switchName, i, thisVal, otherVal;
    for (;;) {
        for ( switchName of switchBitOffsets.keys() ) {
            thisVal = this.evaluateSwitch(switchName, srcHostname);
            otherVal = other.evaluateSwitch(switchName, srcHostname);
            if ( thisVal !== otherVal ) {
                out.push({
                    'what': switchName,
                    'src': srcHostname
                });
            }
        }
        i = desHostnames.length;
        while ( i-- ) {
            desHostname = desHostnames[i];
            for ( type of typeBitOffsets.keys() ) {
                thisVal = this.evaluateCell(srcHostname, desHostname, type);
                otherVal = other.evaluateCell(srcHostname, desHostname, type);
                if ( thisVal === otherVal ) { continue; }
                out.push({
                    'what': 'rule',
                    'src': srcHostname,
                    'des': desHostname,
                    'type': type
                });
            }
        }
        srcHostname = toBroaderHostname(srcHostname);
        if ( srcHostname === '' ) { break; }
    }
    return out;
};

Matrix.prototype.applyDiff = function(diff, from) {
    var changed = false;
    var i = diff.length;
    var action, val;
    while ( i-- ) {
        action = diff[i];
        if ( action.what === 'rule' ) {
            val = from.evaluateCell(action.src, action.des, action.type);
            changed = this.setCell(action.src, action.des, action.type, val) || changed;
            continue;
        }
        if ( switchBitOffsets.has(action.what) ) {
            val = from.evaluateSwitch(action.what, action.src);
            changed = this.setSwitch(action.what, action.src, val) || changed;
            continue;
        }
    }
    return changed;
};

Matrix.prototype.copyRuleset = function(entries, from, deep) {
    let changed = false;
    for ( let entry of entries ) {
        let srcHn = entry.srcHn;
        for (;;) {
            if (
                entry.switchName !== undefined &&
                switchBitOffsets.has(entry.switchName)
            ) {
                let val = from.evaluateSwitch(entry.switchName, srcHn);
                if ( this.setSwitch(entry.switchName, srcHn, val) ) {
                    changed = true;
                }
            } else if ( entry.desHn && entry.type ) {
                let val = from.evaluateCell(srcHn, entry.desHn, entry.type);
                if ( this.setCell(srcHn, entry.desHn, entry.type, val) ) {
                    changed = true;
                }
            }
            if ( !deep ) { break; }
            srcHn = toBroaderHostname(srcHn);
            if ( srcHn === '' ) { break; }
        }
    }
    return changed;
};

return Matrix;

})();
