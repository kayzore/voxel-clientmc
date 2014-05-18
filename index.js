// Generated by CoffeeScript 1.7.0
(function() {
  var ClientMC, decodePacket, ever, minecraft_protocol, ndarray, popCount, tellraw2dom, websocket_stream, webworkify;

  ndarray = require('ndarray');

  websocket_stream = require('websocket-stream');

  minecraft_protocol = require('minecraft-protocol');

  ever = require('ever');

  webworkify = require('webworkify');

  tellraw2dom = require('tellraw2dom');

  popCount = require('bit-twiddle').popCount;

  module.exports = function(game, opts) {
    return new ClientMC(game, opts);
  };

  module.exports.pluginInfo = {
    loadAfter: ['voxel-land', 'voxel-player', 'voxel-registry', 'voxel-console']
  };

  decodePacket = function(data) {
    var buffer, id, isServer, name, packetsToParse, payload, result, state;
    if (!(data instanceof Uint8Array)) {
      return void 0;
    }
    data._isBuffer = true;
    buffer = new Buffer(data);
    state = 'play';
    isServer = false;
    packetsToParse = {
      packet: true
    };
    result = minecraft_protocol.protocol.parsePacket(buffer, state, isServer, packetsToParse);
    if (!result || result.error) {
      console.log('protocol parse error: ' + JSON.stringify(result.error));
      return void 0;
    }
    payload = result.results;
    id = result.results.id;
    name = minecraft_protocol.protocol.packetNames[minecraft_protocol.protocol.states.PLAY].toClient[id];
    return {
      name: name,
      id: id,
      payload: payload
    };
  };

  ClientMC = (function() {
    function ClientMC(game, opts) {
      var _base, _base1, _ref;
      this.game = game;
      this.opts = opts;
      this.registry = (function() {
        var _ref1;
        if ((_ref = (_ref1 = this.game.plugins) != null ? _ref1.get('voxel-registry') : void 0) != null) {
          return _ref;
        } else {
          throw new Error('voxel-clientmc requires voxel-registry plugin');
        }
      }).call(this);
      if ((_base = this.opts).url == null) {
        _base.url = 'ws://localhost:1234';
      }
      if ((_base1 = this.opts).mcBlocks == null) {
        _base1.mcBlocks = {
          0: 'air',
          1: 'stone',
          2: 'grass',
          3: 'dirt',
          4: 'cobblestone',
          5: 'plankOak',
          7: 'obsidian',
          16: 'oreCoal',
          17: 'logOak',
          18: 'leavesOak',
          161: 'leavesOak',
          162: 'logOak',
          "default": 'brick'
        };
      }
      this.mcPlayerHeight = 1.74;
      this.enable();
    }

    ClientMC.prototype.enable = function() {
      var maxId, mcID, ourBlockID, ourBlockName, _i, _ref, _ref1, _ref2, _ref3, _ref4, _ref5, _ref6;
      if ((_ref = this.game.plugins) != null) {
        _ref.disable('voxel-land');
      }
      if ((_ref1 = this.game.plugins) != null) {
        _ref1.enable('voxel-fly');
      }
      this.ws = websocket_stream(this.opts.url, {
        type: Uint8Array
      });
      this.game.voxels.on('missingChunk', this.missingChunk.bind(this));
      this.voxelChunks = {};
      this.ws.on('error', (function(_this) {
        return function(err) {
          var _ref2;
          console.log('WebSocket error', err);
          return (_ref2 = _this.game.plugins) != null ? _ref2.disable('voxel-clientmc') : void 0;
        };
      })(this));
      this.ws.on('end', (function(_this) {
        return function() {
          var _ref2;
          console.log('WebSocket end');
          return (_ref2 = _this.game.plugins) != null ? _ref2.disable('voxel-clientmc') : void 0;
        };
      })(this));
      this.ws.on('data', (function(_this) {
        return function(data) {
          var packet;
          packet = decodePacket(data);
          if (packet == null) {
            return;
          }
          return _this.handlePacket(packet.name, packet.payload);
        };
      })(this));
      if ((_ref2 = this.game.plugins) != null) {
        if ((_ref3 = _ref2.get('voxel-console')) != null) {
          if ((_ref4 = _ref3.widget) != null) {
            _ref4.on('input', this.onConsoleInput = (function(_this) {
              return function(text) {
                return _this.sendChat(text);
              };
            })(this));
          }
        }
      }
      this.zlib_worker = webworkify(require('./zlib_worker.js'));
      ever(this.zlib_worker).on('message', this.onDecompressed.bind(this));
      this.packetPayloadsPending = {};
      this.packetPayloadsNextID = 0;
      maxId = 255;
      this.translateBlockIDs = new this.game.arrayType(maxId);
      for (mcID = _i = 0, _ref5 = this.translateBlockIDs.length; 0 <= _ref5 ? _i < _ref5 : _i > _ref5; mcID = 0 <= _ref5 ? ++_i : --_i) {
        this.translateBlockIDs[mcID] = this.registry.getBlockIndex(this.opts.mcBlocks["default"]);
      }
      _ref6 = this.opts.mcBlocks;
      for (mcID in _ref6) {
        ourBlockName = _ref6[mcID];
        ourBlockID = this.registry.getBlockIndex(ourBlockName);
        if (ourBlockID == null) {
          throw new Error("voxel-clientmc unrecognized block name: " + ourBlockName + " for MC " + mcID);
        }
        this.translateBlockIDs[mcID] = ourBlockID;
      }
      this.chunkBits = Math.log(this.game.chunkSize) / Math.log(2);
      this.chunkBits |= 0;
      return this.chunkMask = (1 << this.chunkBits) - 1;
    };

    ClientMC.prototype.disable = function() {
      var _ref;
      console.log('voxel-clientmc disablingd');
      this.game.voxels.removeListener('missingChunk', this.missingChunk);
      if ((_ref = this.game.plugins) != null) {
        _ref.get('voxel-console').widget.removeListener('input', this.onConsoleInput);
      }
      this.ws.end();
      return typeof this.clearPositionUpdateTimer === "function" ? this.clearPositionUpdateTimer() : void 0;
    };

    ClientMC.prototype.handlePacket = function(name, payload) {
      var blockID, byteLength, byteOffset, compressed, id, ourY, _ref, _ref1, _ref2;
      if (name === 'map_chunk_bulk') {
        console.log('payload.compressedChunkData ', payload.compressedChunkData.length, payload.compressedChunkData);
        id = this.packetPayloadsNextID;
        this.packetPayloadsPending[id] = payload;
        this.packetPayloadsNextID += 1;
        compressed = payload.compressedChunkData.buffer;
        byteLength = payload.compressedChunkData.byteLength;
        byteOffset = payload.compressedChunkData.byteOffset;
        console.log('sending compressedBuffer ', byteLength);
        return this.zlib_worker.postMessage({
          id: id,
          compressed: compressed,
          byteOffset: byteOffset,
          byteLength: byteLength
        }, [compressed]);
      } else if (name === 'spawn_position') {
        console.log('Spawn at ', payload);
        if ((_ref = this.game.plugins) != null) {
          _ref.get('voxel-player').moveTo(payload.x, payload.y, payload.z);
        }
        return this.setupPositionUpdates();
      } else if (name === 'block_change') {
        console.log('block_change', payload);
        blockID = this.translateBlockIDs[payload.type];
        return this.game.setBlock([payload.x, payload.y, payload.z], blockID);
      } else if (name === 'position') {
        console.log('player pos and look', payload);
        ourY = payload.y - 1.62;
        if ((_ref1 = this.game.plugins) != null) {
          _ref1.get('voxel-player').moveTo(payload.x, ourY, payload.z);
        }
        return this.sendPacket('position', payload);
      } else if (name === 'kick_disconnect') {
        return window.alert("Disconnected from server: " + payload.reason);
      } else if (name === 'chat') {
        return (_ref2 = this.game.plugins) != null ? _ref2.get('voxel-console').logNode(tellraw2dom(payload.message)) : void 0;
      }
    };

    ClientMC.prototype.sendChat = function(text) {
      return this.sendPacket('chat_message', {
        message: text
      });
    };

    ClientMC.prototype.setupPositionUpdates = function() {
      return this.clearPositionUpdateTimer = this.game.setInterval(this.sendPositionUpdate.bind(this), 50);
    };

    ClientMC.prototype.sendPositionUpdate = function() {
      var onGround, pos, stance, x, y, z, _ref;
      pos = (_ref = this.game.plugins) != null ? _ref.get('voxel-player').yaw.position : void 0;
      if (pos == null) {
        return;
      }
      x = pos.x;
      y = pos.y + 1;
      z = pos.z;
      stance = y + this.mcPlayerHeight;
      onGround = true;
      return this.sendPacket('position', {
        x: x,
        y: y,
        z: z,
        stance: stance,
        onGround: onGround
      });
    };

    ClientMC.prototype.sendPacket = function(name, params) {
      var data, state;
      state = 'play';
      data = minecraft_protocol.protocol.createPacketBuffer(name, state, params);
      return this.ws.write(data);
    };

    ClientMC.prototype.onDecompressed = function(ev) {
      var i, id, inflated, meta, offset, payload, size, _i, _len, _ref;
      console.log('onDecompressed', ev);
      id = ev.data.id;
      payload = this.packetPayloadsPending[id];
      delete this.packetPayloadsPending[id];
      if (ev.data.err) {
        console.log('received decompression error', ev.data.err, ' for ', ev.data.id);
        return;
      }
      inflated = new Buffer(new Uint8Array(ev.data.decompressed));
      console.log('  decomp', id, inflated.length);
      offset = meta = size = 0;
      _ref = payload.meta;
      for (i = _i = 0, _len = _ref.length; _i < _len; i = ++_i) {
        meta = _ref[i];
        size = (8192 + (payload.skyLightSent ? 2048 : 0)) * popCount(meta.bitMap) + 2048 * popCount(meta.addBitMap) + 256;
        this.addColumn({
          x: meta.x,
          z: meta.z,
          bitMap: meta.bitMap,
          addBitMap: meta.addBitMap,
          skyLightSent: payload.skyLightSent,
          groundUp: true,
          data: inflated.slice(offset, offset + size)
        });
        offset += size;
      }
      if (offset !== inflated.length) {
        return console.log("incomplete chunk decode: " + offset + " != " + inflated.length);
      }
    };

    ClientMC.prototype.addColumn = function(args) {
      var chunkX, chunkY, chunkZ, column, dx, dy, dz, mcBlockID, miniChunk, offset, ourBlockID, size, vchunkKey, vindex, x, y, z, _i, _results;
      chunkX = args.x;
      chunkZ = args.z;
      column = [];
      offset = 0;
      size = 4096;
      _results = [];
      for (chunkY = _i = 0; _i < 16; chunkY = ++_i) {
        if (args.bitMap & (1 << chunkY)) {
          miniChunk = args.data.slice(offset, offset + size);
          offset += size;
          _results.push((function() {
            var _j, _results1;
            _results1 = [];
            for (dy = _j = 0; _j < 16; dy = ++_j) {
              y = chunkY * 16 + dy;
              _results1.push((function() {
                var _k, _results2;
                _results2 = [];
                for (dz = _k = 0; _k < 16; dz = ++_k) {
                  z = chunkZ * 16 + dz;
                  _results2.push((function() {
                    var _base, _l, _results3;
                    _results3 = [];
                    for (dx = _l = 0; _l < 16; dx = ++_l) {
                      x = chunkX * 16 + dx;
                      mcBlockID = miniChunk[dx + dz * 16 + dy * 16 * 16];
                      vchunkKey = (x >> this.chunkBits) + '|' + (y >> this.chunkBits) + '|' + (z >> this.chunkBits);
                      if ((_base = this.voxelChunks)[vchunkKey] == null) {
                        _base[vchunkKey] = new this.game.arrayType(this.game.chunkSize * this.game.chunkSize * this.game.chunkSize);
                      }
                      ourBlockID = this.translateBlockIDs[mcBlockID];
                      vindex = (x & this.chunkMask) + ((y & this.chunkMask) << this.chunkBits) + ((z & this.chunkMask) << this.chunkBits * 2);
                      _results3.push(this.voxelChunks[vchunkKey][vindex] = ourBlockID);
                    }
                    return _results3;
                  }).call(this));
                }
                return _results2;
              }).call(this));
            }
            return _results1;
          }).call(this));
        } else {

        }
      }
      return _results;
    };

    ClientMC.prototype.missingChunk = function(pos) {
      var chunk, shape, voxels;
      voxels = this.voxelChunks[pos.join('|')];
      if (voxels == null) {
        return;
      }
      shape = [this.game.chunkSize, this.game.chunkSize, this.game.chunkSize];
      if (!this.game.voxels.voxelIndex) {
        chunk = ndarray(voxels, shape);
        chunk.position = pos;
      } else {
        chunk = {
          position: pos,
          dims: shape,
          voxels: voxels
        };
      }
      return this.game.showChunk(chunk);
    };

    return ClientMC;

  })();

}).call(this);
