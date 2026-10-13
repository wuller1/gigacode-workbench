/* Prototype-only schema visibility preferences. No SQL or connection credentials. */
(function (global) {
  'use strict';
  var KEY = 'gigacode.prototype.schema-filter.v1';
  var VERSION = 1;
  var owns = function (value, key) { return Object.prototype.hasOwnProperty.call(value, key); };

  function catalogEntries(catalog) {
    var seen = new Set();
    return (Array.isArray(catalog) ? catalog : []).reduce(function (items, entry) {
      var name = typeof entry === 'string' ? entry : entry && entry.name;
      if (typeof name !== 'string' || !name.length || seen.has(name)) return items;
      seen.add(name);
      var system = typeof entry === 'object' && typeof entry.system === 'boolean'
        ? entry.system : name === 'information_schema' || /^pg_/.test(name);
      items.push({name: name, system: system});
      return items;
    }, []);
  }

  function create(options) {
    options = options || {};
    var storage = null;
    try { storage = owns(options, 'storage') ? options.storage : global.localStorage; } catch (_) {}
    var selections = Object.create(null);
    try {
      var raw = storage && storage.getItem(KEY);
      var saved = raw && JSON.parse(raw);
      if (saved && saved.version === VERSION && saved.scopes && typeof saved.scopes === 'object' && !Array.isArray(saved.scopes)) {
        Object.keys(saved.scopes).forEach(function (scope) {
          var names = saved.scopes[scope];
          if (Array.isArray(names) && names.every(function (name) { return typeof name === 'string' && name.length > 0; })) {
            selections[scope] = Array.from(new Set(names));
          }
        });
      }
    } catch (_) { /* Preferences remain usable when storage is unavailable/corrupt. */ }

    function get(scope, catalog) {
      var entries = catalogEntries(catalog);
      var selected = typeof scope === 'string' && owns(selections, scope) ? new Set(selections[scope]) : null;
      return Object.freeze(entries.filter(function (entry) {
        return selected ? selected.has(entry.name) : !entry.system;
      }).map(function (entry) { return entry.name; }));
    }

    function set(scope, names, catalog) {
      if (typeof scope !== 'string' || !scope.length) return get(scope, catalog);
      if (names === null) delete selections[scope];
      else if (Array.isArray(names)) {
        var requested = new Set(names.filter(function (name) { return typeof name === 'string'; }));
        selections[scope] = catalogEntries(catalog).filter(function (entry) {
          return requested.has(entry.name);
        }).map(function (entry) { return entry.name; });
      } else return get(scope, catalog);
      try {
        if (storage) storage.setItem(KEY, JSON.stringify({version: VERSION, scopes: selections}));
      } catch (_) { /* Keep the current-session choice even when persistence fails. */ }
      return get(scope, catalog);
    }

    return Object.freeze({get: get, set: set});
  }

  global.SuiteSchemaFilter = Object.freeze({create: create, storageKey: KEY, version: VERSION});
})(window);
