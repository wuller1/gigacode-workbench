'use strict';

// Theia 1.76 uses require('decompress') as a callable CommonJS export.
// Its unmaintained upstream has no fix for GHSA-mp2f-45pm-3cg9.
// Adapt the maintained ESM fork without changing Theia or its CLI callers.
let extractor;
module.exports = async function decompress(...args) {
    extractor ??= import('@xhmikosr/decompress').then(module => module.default);
    return (await extractor)(...args);
};
