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


  // Define the playback object
  const playback = {
    status: "stopped",
    currentPosition: null,
    speed: 1,
    loopStart: null,
    loopEnd: null,
  };

  const file = {
    baseName: null,
    path: null,
    currentPosition: null,
    targetPosition: null,
    start: null,
    end: null,
    loopStart: null,
    loopEnd: null
  };

  //let stopEvent = false;
  const fs = require('fs');
  const readline = require('readline');
  const net = require('net');
  const path = require('path');
  const client = new net.Socket();
  // Connect to TCP server
  client.connect(10110, 'localhost', () => {
    app.debug('Connected to TCP server');
  });

  client.on('close', () => {
    //stopEvent = true;
    playback.status = "stoppped";
    app.debug('Connection to TCP server closed');
  });

  client.on('error', (error) => {
    playback.status = "stoppped";
    app.error('TCP Connection Error: ', error);
  });

  plugin.registerWithRouter = function (router) {
    app.debug('registerWithRouter')
    router.get('/status', (req, res) => {
      res.contentType('application/json')
      res.send(JSON.stringify(getPlayback()))
    })
    router.get('/getCurrent', (req, res) => {
      res.contentType('application/json')
      res.send(JSON.stringify(wrapMarker(file.currentPosition)));
    })
    router.get('/getTarget', (req, res) => {
      res.contentType('application/json')
      res.send(JSON.stringify(wrapMarker(file.targetPosition)));
    })
    router.post('/play', (req, res) => {
      if (playback.status != "stopped") playback.status = 'playing';
      res.status(200).send(JSON.stringify(getPlayback()));
    })
    router.post('/pause', (req, res) => {
      if (playback.status != "stopped") playback.status = 'paused';
      res.status(200).send(JSON.stringify(getPlayback()));
    })
    router.post('/rewind', (req, res) => {
      playback.targetPosition = playback.start;
      res.status(200).send(JSON.stringify(getPlayback()));
    })
    router.post('/setStart', (req, res) => {
      file.loopStart = PercentagToDate(req.body.value);
      res.status(200).send(JSON.stringify(wrapMarker(file.loopStart)));
    })
    router.post('/setEnd', (req, res) => {
      file.loopEnd = PercentagToDate(req.body.value);
      res.status(200).send(JSON.stringify(wrapMarker(file.loopEnd)));
    })
    router.post('/setSpeed', (req, res) => {
      playback.speed = req.body.value;
      res.status(200).send(JSON.stringify(getPlayback()));
    })
    router.post('/setTarget', (req, res) => {
      file.targetPosition = PercentagToDate(req.body.value);
      res.status(200).send(JSON.stringify(wrapMarker(file.targetPosition)));
    })
  }

  function wrapMarker(date) {
    return { percentage: dateToPercentage(date), date: date ? date.toLocaleTimeString() : null };
  }

  function dateToPercentage(date) {
    if (date === null) return null;
    return 100.0 * (date.getTime() - file.start.getTime()) / (file.end.getTime() - file.start.getTime());
  }

  function PercentagToDate(perc) {
    return new Date((perc / 100.0) * (file.end.getTime() - file.start.getTime()) + file.start.getTime());
  }

  function getPlayback() {
    playback.loopStart = dateToPercentage(file.loopStart) ?? 0;
    playback.loopEnd = dateToPercentage(file.loopEnd) ?? 100;
    playback.currentPosition = dateToPercentage(file.currentPosition) ?? 0;
    return playback;
  }


  plugin.start = function (options, restartPlugin) {

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
            setTimeout(resolve, wait);
          } else {
            resolve();
          }
        });
      };
      for await (const line of rl) {
        //if (stopEvent) {
        if (playback.status == "stopped") {
          app.debug(`Stop processing ${file.path}`);
          break;
        }
        while (playback.status == 'paused') {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        await processLine(line);
      }

      rl.close();
      app.debug('Finished reading file.');
    };

    const startReading = async () => {
      while (true) {
        app.debug(`Start processing ${filename}`);
        playback.status = "playing";
        await processFile();
        if (playback.status == "stopped") break;
      }
    };

    function handleLine(line) {
      let wait = 0;
      if (!isValidNMEA0183(line)) {
        //app.debug(`msg ignored: ${line}`);
        return 0;
      }
      msg = line.substr(3, 3);
      let rmcTime = null;
      if (line.substr(3, 3) == "RMC") {
        const fields = line.split(',');
        if (fields[9]) rmcTime = toDate(fields[1], fields[9]);
      }
      if (rmcTime) {
        file.currentPosition = rmcTime;
      }
      if (lookingForTarget()) return 0;

      if (!withinTimeWindow()) return 0;

      if (rmcTime) {
        const now = Date.now();
        const waitTime = Math.min((rmcTime - previousRMCTime), 1000) / playback.speed;
        const elapsedTime = now - previousSendTime;
        wait = Math.max(waitTime - elapsedTime, 0);
        previousRMCTime = rmcTime;
        previousSendTime = now;
      }
      client.write(line + '\n');
      return wait;
    }

    function lookingForTarget() {
      if (file.targetPosition === null) return false;
      if (Math.abs(file.targetPosition - file.currentPosition) <= 1000) {
        file.targetPosition = null;
        return false;
      }
      return true;
    }

    function withinTimeWindow() {
      let within = false;
      if (!file.loopStart || file.loopStart < file.currentPosition) within = true;
      if (file.loopEnd && file.loopEnd < file.currentPosition) within = false;
      return within;
    }

    function toDate(time, datum) {
      const day = parseInt(datum.substr(0, 2), 10);
      const month = parseInt(datum.substr(2, 2), 10) - 1;
      const year = parseInt(datum.substr(4, 2), 10) + 2000;
      const hours = parseInt(time.substr(0, 2), 10);
      const minutes = parseInt(time.substr(2, 2), 10);
      const seconds = parseInt(time.substr(4, 2), 10);
      let miliseconds = parseInt(time.substr(7, 2), 10) * 10;
      if (isNaN(miliseconds)) miliseconds = 0;
      return new Date(year, month, day, hours, minutes, seconds, miliseconds);
    }

    function isValidNMEA0183(line) {
      // Check if the line starts with a '$'
      if (!(line.startsWith('$') || line.startsWith('!'))) {
        return false;
      }

      // Check if the line contains a valid checksum
      const parts = line.split('*');
      if (parts.length !== 2) {
        return false;
      }

      const message = parts[0].substring(1); // Remove the starting '$'
      const checksum = parts[1];

      // Calculate the checksum
      let calculatedChecksum = 0;
      for (let i = 0; i < message.length; i++) {
        calculatedChecksum ^= message.charCodeAt(i);
      }

      // Convert the checksum to a two-digit hexadecimal
      const hexChecksum = calculatedChecksum.toString(16).toUpperCase().padStart(2, '0');

      // Check if the calculated checksum matches the given checksum
      return hexChecksum === checksum;
    }

    let previousRMCTime = new Date(1970, 0, 1);
    let previousSendTime = new Date(1970, 0, 1);

    app.debug("Plugin started with options: ", options);
    //stopEvent = false;

    // Ensure the filename is given in a full path format
    const filename = options.filename ? path.resolve(options.filename) : null;
    if (filename != null) {
      file.baseName = path.basename(filename);
      file.path = filename;
    }
    else {
      file.baseName = null;
      file.path = null;
    }
    playback.status = 'stopped';
    playback.speed = 1;



    const fs = require('fs');
    const readline2 = require('readline');

    async function analyseFile() {
      const fileStream = fs.createReadStream(file.path);

      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity  // Handles different newline characters
      });

      for await (const line of rl) {
        scanLine(line);
      }
      ;
    }



    function scanLine(line) {
      if (!isValidNMEA0183(line)) return 0;
      if (line.substr(3, 3) != "RMC") return 0;
      const fields = line.split(',');
      if (!fields[9]) return;
      const dateTime = toDate(fields[1], fields[9]);
      if (!file.start) {
        file.start = dateTime;
      }
      file.end = dateTime;
      return 0;
    }

    if (!file.path) {
      app.error("No filename provided");
      return;
    } else {
      file.currentPosition = null;
      file.targetPosition = null;
      file.start = null;
      file.end = null;
      file.loopStart = null;
      file.loopEnd = null;
      app.debug("Analysing file");
      analyseFile()
        .then(result => {
          file.loopStart = file.start;
          file.loopEnd = file.end;
          app.debug(file);
        });
      /* .catch(err => {
        app.error('Error analysing file:', err);
      }); */
      app.debug(file);
      startReading();
    }
  };



  plugin.stop = function () {
    //stopEvent = true;
    playback.status = "stopped";
    app.debug("Stopping plugin");
  };

  return plugin;
};
