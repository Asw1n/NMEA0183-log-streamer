module.exports = function (app) {
  var plugin = {};
  plugin.id = "nmea-streamer";
  plugin.name = "NMEA-streamer";
  plugin.description = "The plugin streams a file with NMEA0183 messages to the Signal K server at a configurable speed.";
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
      startTime: {
        type: "string",
        title: "Start time",
        description: "Optional start time in HH:MM:SS format"
      },
      endTime: {
        type: "string",
        title: "End time",
        description: "Optional end time in HH:MM:SS format"
      },
      speedFactor: {
        type: "number",
        title: "Speed Factor",
        description: "Factor of real-time speed (e.g., 1 is real-time, 2 is twice as fast, etc.)",
        default: 1
      }
    }
  };

  let stopEvent = false;
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
    stopEvent = true;
    app.debug('Connection to TCP server closed');
  });

  client.on('error', (error) => {
    app.error('TCP Connection Error: ', error);
  });


  plugin.start = function (options) {

    // Proces log file
    const processFile = async () => {
      const fileStream = fs.createReadStream(filename);

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
        if (stopEvent) {
          app.debug(`Stop processing ${filename}`);
          break;
        }
        await processLine(line);
      }

      rl.close();
      app.debug('Finished reading file.');
    };

    const startReading = async () => {
      while (true) {
        if (stopEvent) {
          stopEvent = false;
          break;
        }
        app.debug(`Start processing ${filename}`);
        await processFile();
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
      // CGA:1, GLL:5, RMC:1, ZDA:1, 
      switch (msg) {
        case 'CGA':
          rmcTime = toDate(line.split(',')[1]);
          break;
        case ('GLL'):
          rmcTime = toDate(line.split(',')[5]);
          break;
        case 'RMC':
          rmcTime = toDate(line.split(',')[1]);
          break;
        case 'ZDA':
          rmcTime = toDate(line.split(',')[1]);
          break;
      }
      if (rmcTime) {
        if (startTime && startTime < rmcTime) withinTimeWindow=true;
        if (endTime && endTime < rmcTime) withinTimeWindow=false;
      }

      if (!withinTimeWindow) return 0;

      if (rmcTime) {
        const now = Date.now();
        const waitTime = Math.min((rmcTime - previousRMCTime), 1000) / speedFactor;
        const elapsedTime = now - previousSendTime;
        wait = Math.max(waitTime - elapsedTime, 0);
        previousRMCTime = rmcTime;
        previousSendTime = now;
      }
      client.write(line + '\n');
      return wait;
    }

  

  function toDate(time) {
    const hours = parseInt(time.substr(0, 2), 10);
    const minutes = parseInt(time.substr(2, 2), 10);
    const seconds = parseInt(time.substr(4, 2), 10);
    let miliseconds = parseInt(time.substr(7, 2), 10) * 10;
    if (isNaN(miliseconds)) miliseconds = 0;
    return new Date(1970, 0, 1, hours, minutes, seconds, miliseconds);
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
  stopEvent = false;

  // Ensure the filename is given in a full path format
  const filename = options.filename ? path.resolve(options.filename) : null;
  const speedFactor = options.speedFactor || 1;
  if (options.startTime !== "" && options.startTime !== undefined) {
    startTime = toDate(options.startTime.replace(/:/g, ''));
  } else {
    startTime=0;
  }
  if (options.endTime !== "" && options.endTime !== undefined) {
    endTime = toDate(options.endTime.replace(/:/g, ''));
  } else {
    endTime=0;
  }
  let withinTimeWindow =false;


  if (!filename) {
    app.error("No filename provided");
    return;
  } else {
    startReading();
  }
};



plugin.stop = function () {
  stopEvent = true;
  app.debug("Stopping plugin");
};

return plugin;
};
