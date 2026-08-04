var assert = require('assert');
var paletteBufferForSpec = require('../lib/palette_spec');

// The parser deliberately doesn't touch the mapnik binding, so this runs without the
// native module -- it returns the raw RGBA buffer that mapnik.Palette is built from.
function slots(spec) {
    var buf = paletteBufferForSpec(spec);
    assert.strictEqual(buf.length, 256 * 4, 'expected 256 RGBA slots');
    var out = [];
    for (var i = 0; i < 256; i++) {
        out.push([buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2], buf[i * 4 + 3]]);
    }
    return out;
}

describe('palette spec', function() {

    it('expands a transparent slot plus a gray ramp to 256 entries', function() {
        // The grayscale DEM case: 256 grays + transparent nodata would need 257
        // slots, so gray 0 is given up and pure black is reserved for nodata.
        var e = slots('00000000;010101-ffffff');
        assert.deepStrictEqual(e[0], [0, 0, 0, 0], 'slot 0 is transparent nodata');
        for (var i = 1; i < 256; i++) {
            assert.deepStrictEqual(e[i], [i, i, i, 255], 'slot ' + i + ' is opaque gray ' + i);
        }
    });

    it('keeps pure black unique to nodata', function() {
        // Clients that decode elevation from packed RGB and ignore alpha rely on
        // (0,0,0) meaning "no data".
        var e = slots('00000000;010101-ffffff');
        var blacks = e.filter(function(c) { return c[0] === 0 && c[1] === 0 && c[2] === 0; });
        assert.strictEqual(blacks.length, 1, 'exactly one (0,0,0) slot');
        assert.strictEqual(blacks[0][3], 0, 'and it is the transparent one');
    });

    it('hits both endpoints of a ramp exactly', function() {
        var e = slots('000000-ffffff');
        assert.deepStrictEqual(e[0], [0, 0, 0, 255]);
        assert.deepStrictEqual(e[255], [255, 255, 255, 255]);
    });

    it('interpolates non-gray ramps in RGBA', function() {
        var e = slots('ff0000;00ff00-0000ff');
        assert.deepStrictEqual(e[0], [255, 0, 0, 255]);
        assert.deepStrictEqual(e[1], [0, 255, 0, 255], 'ramp starts at its from-colour');
        assert.deepStrictEqual(e[255], [0, 0, 255, 255], 'ramp ends at its to-colour');
    });

    it('defaults alpha to opaque and honours an explicit alpha', function() {
        var e = slots('0000ff80;010101-ffffff');
        assert.deepStrictEqual(e[0], [0, 0, 255, 0x80]);
        assert.strictEqual(e[1][3], 255, 'ramp colours without alpha are opaque');
    });

    it('shares leftover slots between multiple ramps', function() {
        var e = slots('000000-7f7f7f;808080-ffffff');
        assert.deepStrictEqual(e[0], [0, 0, 0, 255]);
        assert.deepStrictEqual(e[127], [127, 127, 127, 255], 'first ramp ends at its to-colour');
        assert.deepStrictEqual(e[128], [128, 128, 128, 255], 'second ramp starts at its from-colour');
        assert.deepStrictEqual(e[255], [255, 255, 255, 255]);
    });

    it('rejects malformed specs', function() {
        assert.throws(function() { paletteBufferForSpec(''); }, /non-empty string/);
        assert.throws(function() { paletteBufferForSpec(undefined); }, /non-empty string/);
        assert.throws(function() { paletteBufferForSpec('nothex;010101-ffffff'); }, /bad palette colour/);
        assert.throws(function() { paletteBufferForSpec('0000-ffff'); }, /bad palette colour/);
        assert.throws(function() { paletteBufferForSpec('000000-111111-222222'); }, /bad palette entry/);
    });

    it('rejects 3-digit hex', function() {
        // Only RRGGBB / RRGGBBAA are accepted -- callers expand shorthand before
        // building a spec, so there's one canonical form here.
        assert.throws(function() { paletteBufferForSpec('000-fff'); }, /bad palette colour/);
    });

    it('rejects a fixed-colour spec that is not exactly 256 slots', function() {
        assert.throws(function() { paletteBufferForSpec('000000;ffffff'); },
            /exactly 256 slots/);
    });

    it('rejects more entries than there are slots', function() {
        var tooMany = [];
        for (var i = 0; i < 300; i++) tooMany.push('010101');
        assert.throws(function() { paletteBufferForSpec(tooMany.join(';')); },
            /more than 256 slots/);
    });
});
