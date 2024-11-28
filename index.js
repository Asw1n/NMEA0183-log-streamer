module.exports = function (app) {
  var plugin = {};
  plugin.id = "nmea-streamer";
  plugin.name = "NMEA-streamer";
  plugin.description = "NMEA streamer plays a file with NMEA0183 messages at a configurable speed.";
  plugin.author = "aswin.bouwmeester@gmail.com";

  // Configuratie schema
  plugin.schema = {
    title: "NMEA0183 Log Streamer",
    description: `Configure the NMEA0183 Log Streamer. 
    The NMEA0183 Log Streamer streams a file containing NMEA messages to the signal K server at real time or increased speed.
    In order for the plugin to work one has to define a data connection of type NMEA0183 with the NMEA0183 data source being 
    a TCP connection on default port of 10110.
    `,
    type: "object",
    properties: {
      filename: {
        type: "string",
        title: "Filename",
        description: "Full path to the log file"
      },
    }
  };


  const play = {
    status: "stopped",
    speed: 1,
    markerCurrent: null,
    markerTarget: null,
    markerStart: null,
    markerEnd: null,
    startedBefore: null,
    lastSyncTime: null,
    lastSyncRmc: null
  };

  const file = {
    baseName: null,
    path: null,
    start: null,
    end: null,
  };

  const fs = require('fs');
  const readline = require('readline');
  const net = require('net');
  const path = require('path');
  const client = new net.Socket();
  const { getDate,
    getDateTimeRange,
    isNmeaMessage,
    isAisMessage, } = require('./nmeautils');
  // Connect to TCP server
  {
    client.connect(10110, 'localhost', () => {
      app.debug('Connected to TCP server');
    });

    client.on('close', () => {
      //stopEvent = true;
      app.debug('Connection to TCP server closed');
    });

    client.on('error', (error) => {
      app.error('TCP Connection Error: ', error);
    });
  }


  plugin.registerWithRouter = function (router) {
    app.debug('registerWithRouter');

    router.get('/getFile', (req, res) => {
      const { baseName, path, start, end } = file;
      res.json({
        baseName,
        path,
        start: start?.toISOString() || null,
        end: end?.toISOString() || null,
      });
    });

    router.get('/getPlay', (req, res) => {
      res.status(200).send(wrapPlay());
    });

    router.post('/markerStart', (req, res) => {
      const markerStart = new Date(req.body.value);
      if (play.markerEnd > markerStart && markerStart < play.markerCurrent) play.markerStart = markerStart;
      res.status(200).json(play.markerStart.toISOString());
    })

    router.post('/markerEnd', (req, res) => {
      const markerEnd = new Date(req.body.value);
      if (play.markerStart < markerEnd && markerEnd > play.markerCurrent) play.markerEnd = markerEnd;
      res.status(200).json(play.markerEnd.toISOString());
    })

    router.post('/markerTarget', (req, res) => {
      const markerTarget = new Date(req.body.value);
      play.markerTarget = markerTarget;
      res.status(200).json(play.markerTarget.toISOString());
    })

    router.post('/status', (req, res) => {
      const valid = ["playing", "paused"];
      const status = req.body.value;
      if (play.status != "stopped" && valid.includes(status)) play.status = status;
      res.status(200).json(play.status);
    })

    router.post('/speed', (req, res) => {
      app.debug(req.body.value);
      play.speed = req.body.value;
      play.lastSyncRmc = play.markerCurrent;
      play.lastSyncTime = Date.now();
      res.status(200).json(play.speed);
    })

  }

  function wrapPlay() {
    return {
      status: play.status,
      speed: play.speed,
      markerTarget: play.markerTarget ? new Date(play.markerTarget) : null,
      markerStart: play.markerStart ? new Date(play.markerStart) : null,
      markerEnd: play.markerEnd ? new Date(play.markerEnd) : null,
      markerCurrent: play.markerCurrent ? new Date(play.markerCurrent) : null
    };
  }

  plugin.start = async function (options, restartPlugin) {

    // Proces log file
    const processFile = async () => {
      const fileStream = fs.createReadStream(file.path);

      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      const processLine = (line) => {
        return new Promise((resolve) => {
          wait = handleLine(line);
          if (wait) {
            setTimeout( resolve, wait);
          } else {
            resolve();
          }
        });
      };

      play.markerCurrent = play.markerStart;
      resetSync();
      for await (const line of rl) {
        //if (stopEvent) {
        if (play.status == "stopping") {
          break;
        }
        while (play.status == 'paused') {
          await new Promise(resolve => setTimeout(resolve, 1000));
          resetSync();
        }
        await processLine(line);
      }

      rl.close();
    };

    const startReading = async () => {
      while (true) {
        app.debug(`Start streaming ${file.baseName}`);
        play.status = "playing";
        await processFile();
        app.debug(`Finish streaming ${file.baseName}`);
        if (play.status == "stopping") {
          play.status = "stopped";
          break;
        }
      }
    };

    function handleLine(line) {
      let wait = 0;
      if (!isNmeaMessage(line) && !isAisMessage(line)) return 0;
      const rmcTime = getDate(line);
      if (rmcTime) {
        play.markerCurrent = rmcTime;
      }
      play.status = 'skipping';
      //lookingForTarget();
      if (lookingForTarget()) { resetSync(); return 0 };
      if (!withinTimeWindow()) { resetSync(); return 0 };
      play.status = 'playing';

      if (rmcTime) {
        wait = timeToWait(rmcTime);
        if (wait < 50) {
          wait = 0;
        }
      }
      client.write(line + '\n');
      return wait;
    }

    function resetSync() {
      play.lastSyncRmc = play.markerCurrent;
      play.lastSyncTime = Date.now();
    }

    function timeToWait(rmcTime) {
      const deltaTime = Date.now() - play.lastSyncTime;
      const deltaRmc = (rmcTime - play.lastSyncRmc);
      return Math.max(deltaRmc / play.speed - deltaTime, 0);
    }

    function lookingForTarget() {
      if (play.markerTarget === null) return false;
      if (play.startedBefore === null) {
        play.startedBefore = play.markerCurrent < play.markerTarget ? true : false;
        return true;
      }
      const before = play.markerCurrent <= play.markerTarget ? true : false;
      //app.debug(`startedBefore=${play.startedBefore}, before=${before}`);
      if ((play.startedBefore && !before) || (!play.startedBefore && before)) {
        play.startedBefore = null;
        play.markerTarget = null;
        return false;
      }
      else {
        //app.debug('Still looking for target');
        return true;
      }
    }

    function withinTimeWindow() {
      return (play.markerCurrent > play.markerStart && play.markerCurrent < play.markerEnd);
    }

    app.debug("Plugin started with options: ", options);
    try {
      // Check if the file exists and is readable
      await fs.promises.access(options.filename, fs.constants.R_OK);
    } catch (error) {
      play.status = 'stopped';
      app.status("Stopped");

      throw new Error(`Failed to access: ${options.filename}`);
    }

    file.baseName = path.basename(options.filename);
    file.path = options.filename;
    play.speed = 1;
    play.status = 'initialising';
    app.debug("Analysing file");
    Object.assign(file, await getDateTimeRange(file.path));
    play.markerStart = new Date(file.start);
    play.markerCurrent = new Date(play.start);
    play.markerEnd = new Date(file.end);
    play.markerTarget = null;
    play.startedBefore = null;
    startReading();
  };



  plugin.stop = function () {
    //stopEvent = true;
    play.status = "stopping";
    app.debug("Stopping");
    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        if (play.status == "stopped") {
          clearInterval(interval);
          app.debug("Stopped");
          resolve('Value met!');
        }
      }, 100);
    });
  }

  return plugin;
};
