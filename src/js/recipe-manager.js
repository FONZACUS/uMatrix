'use strict';

µMatrix.recipeManager = (function() {
    let rawRecipes = [];
    let recipeIdGenerator = 1;
    let recipeBook = new Map();
    let reNoUnicode = /^[\x00-\x7F]$/;

    const authorFromHeader = function(header) {
        let match = /^! +maintainer: +([^\n\r]+)/im.exec(header);
        return match !== null ? match[1].trim() : '';
    };

    const conditionMatch = function(condition, srcHostname, desHostnames) {
        let i = condition.indexOf(' ');
        if ( i === -1 ) { return false; }
        let targetHostname = condition.slice(0, i).trim();
        if ( targetHostname !== '*' ) {
            let hn = srcHostname;
            if ( targetHostname.endsWith('.*') ) {
                let domain = µMatrix.URI.domainFromHostname(hn);
                let pos = domain.indexOf('.');
                if ( pos !== -1 ) {
                    hn = hn.slice(0, pos + hn.length - domain.length) + '.*';
                }
            }
            if ( hn.endsWith(targetHostname) === false ) { return false; }
            let pos = hn.length - targetHostname.length;
            if ( pos !== 0 && hn.charAt(pos - 1) !== '.' ) { return false; }
        }
        targetHostname = condition.slice(i + 1).trim();
        if ( targetHostname === '*' ) { return true; }
        for ( let hn of desHostnames ) {
            if ( hn === srcHostname ) { continue; }
            if ( hn.endsWith(targetHostname) ) { return true; }
        }
        return false;
    };

    const toASCII = function(rule) {
        if ( reNoUnicode.test(rule) ) { return rule; }
        let parts = rule.split(/\s+/);
        for ( let i = 0; i < parts.length; i++ ) {
            parts[i] = punycode.toASCII(parts[i]);
        }
        return parts.join(' ');
    };

    const compareLength = function(a, b) {
        return b.length - a.length;
    };

    const getTokens = function(s) {
        let tokens = s.match(/[a-z0-9]+/gi);
        if ( tokens === null ) { return []; }
        return tokens;
    };

    const addRecipe = function(recipe) {
        let tokens = getTokens(recipe.condition);
        tokens.sort(compareLength);
        let token = tokens[0];
        let recipes = recipeBook.get(token);
        if ( recipes === undefined ) {
            recipeBook.set(token, recipes = []);
        }
        recipes.push(recipe);
    };

    const fromString = function(raw) {
        const reValidRecipeFile = /^! uMatrix: Ruleset recipes [0-9.]+[\n\r]+/;
        const rawHeader = raw.slice(0, 1024);
        if ( reValidRecipeFile.test(rawHeader) === false ) { return; }
        const reComment = /^[!#]/;
        let maintainer = authorFromHeader(rawHeader);
        let recipeName,
            recipeCondition,
            recipeRuleset;
        let lineIter = new µMatrix.LineIterator(raw);
        for (;;) {
            let line = lineIter.next().trim();
            if ( line.length === 0 ) {
                if (
                    recipeName !== undefined &&
                    recipeCondition !== undefined &&
                    recipeRuleset.length !== 0
                ) {
                    addRecipe({
                        id: recipeIdGenerator++,
                        name: recipeName,
                        maintainer: maintainer,
                        condition: recipeCondition,
                        ruleset: recipeRuleset
                    });
                }
                recipeName = undefined;
                recipeCondition = undefined;
            }
            if ( lineIter.eot() && recipeName === undefined ) { break; }
            if ( line.length === 0 ) { continue; }
            let isComment = reComment.test(line);
            if ( isComment && recipeCondition === undefined ) { continue; }
            if ( recipeName === undefined ) {
                recipeName = line;
                recipeCondition = undefined;
                continue;
            }
            if ( recipeCondition === undefined ) {
                recipeCondition = toASCII(line);
                recipeRuleset = '';
                continue;
            }
            if ( recipeRuleset.length !== 0 ) {
                recipeRuleset += '\n';
            }
            recipeRuleset += isComment ? line : toASCII(line);
        }
    };

    const fromPendingStrings = function() {
        if ( rawRecipes.length === 0 ) { return; }
        for ( var raw of rawRecipes ) {
            fromString(raw);
        }
        rawRecipes = [];
    };

    const evaluateRuleParts = function(matrix, scope, parts) {
        if ( parts[0].endsWith(':') ) {
            return matrix.evaluateSwitchZ(parts[0].slice(0, -1), scope);
        }
        return matrix.evaluateCellZXY(scope, parts[1], parts[2]) === 1;
    };

    const api = {};

    api.apply = function(details) {
        const reComment = /^[!#]/;
        const µm = µMatrix;
        const tMatrix = µm.tMatrix;
        const pMatrix = µm.pMatrix;
        let mustPersist = false;
        for ( const rule of details.ruleset.split('\n') ) {
            if ( reComment.test(rule) ) { continue; }
            let parts = rule.split(/\s+/);
            if ( parts.length < 2 ) { continue; }
            let f0 = parts[0];
            let f1 = parts[1];
            if ( f0.endsWith(':') ) {
                f0 = f0.slice(0, -1);
                if ( tMatrix.evaluateSwitchZ(f0, f1) !== false ) {
                    tMatrix.setSwitchZ(f0, f1, false);
                    if ( details.commit ) {
                        pMatrix.setSwitchZ(f0, f1, false);
                        mustPersist = true;
                    }
                }
                continue;
            }
            if ( parts.length < 3 ) { continue; }
            let f2 = parts[2];
            let action = tMatrix.evaluateCellZXY(f0, f1, f2);
            if ( (action & 3) === 1 ) {
                tMatrix.whitelistCell(f0, f1, f2);
            }
            if ( details.commit !== true ) { continue; }
            action = pMatrix.evaluateCellZXY(f0, f1, f2);
            if ( (action & 3) === 1 ) {
                pMatrix.whitelistCell(f0, f1, f2);
                mustPersist = true;
            }
        }
        if ( mustPersist ) {
            µm.saveMatrix();
        }
    };

    api.fetch = function(srcHostname, desHostnames, callback) {
        fromPendingStrings();
        let out = [];
        let fetched = new Set();
        let tokens = getTokens(srcHostname + ' ' + desHostnames.join(' '));
        for ( let token of tokens ) {
            let recipes = recipeBook.get(token);
            if ( recipes === undefined ) { continue; }
            for ( let recipe of recipes ) {
                if ( fetched.has(recipe.id) ) { continue; }
                if (
                    conditionMatch(
                        recipe.condition,
                        srcHostname,
                        desHostnames
                    )
                ) {
                    out.push(recipe);
                    fetched.add(recipe.id);
                }
            }
        }
        callback(out);
    };

    api.statuses = function(details) {
        let pMatrix = µMatrix.pMatrix,
            tMatrix = µMatrix.tMatrix;
        let reComment = /^[!#]/;
        for ( let recipe of details.recipes ) {
            let ruleIter = new µMatrix.LineIterator(recipe.ruleset);
            while ( ruleIter.eot() === false ) {
                let rule = ruleIter.next();
                if ( reComment.test(rule) ) { continue; }
                let parts = rule.split(/\s+/);
                if (
                    recipe.mustCommit !== true &&
                    evaluateRuleParts(pMatrix, details.scope, parts)
                ) {
                    recipe.mustCommit = true;
                    if ( recipe.mustImport ) { break; }
                }
                if (
                    recipe.mustImport !== true &&
                    evaluateRuleParts(tMatrix, details.scope, parts)
                ) {
                    recipe.mustImport = true;
                    if ( recipe.mustCommit ) { break; }
                }
            }
        }
        return details;
    };

    api.fromString = function(raw) {
        rawRecipes.push(raw);
    };

    api.reset = function() {
        rawRecipes.length = 0;
        recipeBook.clear();
    };

    return api;
})();
