var fs = require('fs');
var os = require('os');
var path = require('path');
var assert = require('assert');
var mapnik_backend = require('..');
var mapnik = require('mapnik');

// Copy world.xml and its shapefile into a temp dir, so the data can be removed
// after the source has opened. That makes creating further pooled maps fail,
// like a PostGIS datasource whose database has gone away.
function tempWorld() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tilelive-mapnik-'));
    var src = path.join(__dirname, 'data');
    fs.copyFileSync(path.join(src, 'world.xml'), path.join(dir, 'world.xml'));
    fs.mkdirSync(path.join(dir, 'world_merc'));
    fs.readdirSync(path.join(src, 'world_merc')).forEach(function(f) {
        fs.copyFileSync(path.join(src, 'world_merc', f), path.join(dir, 'world_merc', f));
    });
    return dir;
}

describe('Pool', function() {

    it('returns an error instead of hanging when a map cannot be created', function(done) {
        this.timeout(5000);
        var dir = tempWorld();
        var hidden = path.join(dir, 'world_merc_hidden');
        new mapnik_backend({
            pathname: path.join(dir, 'world.xml'),
            mml: {},
            query: { poolSize: 4, metatile: 1, internal_cache: false }
        }, function(err, source) {
            if (err) return done(err);
            // Opening created one map; it's idle in the pool now.
            fs.renameSync(path.join(dir, 'world_merc'), hidden);
            // Count map creations, to catch a pool that retries failed creates.
            var fromString = mapnik.Map.prototype.fromString;
            var creates = 0;
            mapnik.Map.prototype.fromString = function() {
                creates++;
                return fromString.apply(this, arguments);
            };
            // Two concurrent renders: one gets the idle map, the other needs a
            // new map, whose creation fails.
            var results = [];
            [[0, 0], [1, 1]].forEach(function(xy) {
                source.getTile(1, xy[0], xy[1], function(err) {
                    results.push(err);
                    if (results.length < 2) return;
                    mapnik.Map.prototype.fromString = fromString;
                    assert.equal(creates, 1, 'failed map create was retried');
                    assert.ok(results.some(function(e) { return e && /does not exist/.test(e.message); }), 'expected a create error');
                    // Once the data is back, the source renders again.
                    fs.renameSync(hidden, path.join(dir, 'world_merc'));
                    source.getTile(2, 1, 1, function(err, tile) {
                        if (err) return done(err);
                        assert.ok(tile.length > 0);
                        source.close(done);
                    });
                });
            });
        });
    });
});
