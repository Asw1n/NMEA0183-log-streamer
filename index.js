module.exports = function(app) {
    var plugin = {};
    plugin.id = "nmea0183-log-streamer";
    plugin.name = "NMEA0183 Log Streamer";
    plugin.description = "The plugin streams a file with NMEA0183 messages to the Signal K server at a configurable speed.";
    plugin.author = "aswin.bouwmeester@gmail.com";
  
    // Configuratie schema
    plugin.schema = {
      title: "NMEA0183 Log Streamer",
      description: "Configure this simple plugin",
      type: "object",
      properties: {
        filename: {
          type: "string",
          title: "Filename",
          description: "Full path to the log file"
        },
        speedFactor: {
          type: "number",
          title: "Speed Factor",
          description: "Factor of real-time speed (e.g., 1 is real-time, 2 is twice as fast, etc.)",
          default: 1
        }
      }
    };
  
    plugin.start = function(options) {
      app.debug("Plugin started with options: ", options);
  
      const fs = require('fs');
      const readline = require('readline');
      const net = require('net');
      const path = require('path');
  
      // Ensure the filename is given in a full path format
      const filename = options.filename ? path.resolve(options.filename) : null;
      const speedFactor = options.speedFactor || 1;
  
      if (!filename) {
        app.error("No filename provided");
        return;
      }
  
      let previousRMCTime = null;
      let previousSendTime = null;
  
      // Connect to TCP server
      const client = new net.Socket();
      client.connect(10110, 'localhost', () => {
        app.debug('Connected to TCP server');
        readAndSendLines();
      });
  
      client.on('close', () => {
        app.debug('Connection to TCP server closed');
      });
  
      client.on('error', (error) => {
        app.error('TCP Connection Error: ', error);
      });
  
      function readAndSendLines() {
        const rl = readline.createInterface({
          input: fs.createReadStream(filename),
          output: null,
          terminal: false
        });
  
        rl.on('line', (line) => {
          handleLine(line);
        });
  
        rl.on('close', () => {
          app.debug('Finished reading file, starting over');
          setImmediate(() => readAndSendLines());
        });
      }
  
      function handleLine(line) {
        const isRMC = line.startsWith('$GPRMC') || line.startsWith('$GNRMC');
  
        if (isRMC) {
          const parts = line.split(',');
          const rmcTime = parts[1]; // HHMMSS format
  
          if (previousRMCTime) {
            const elapsedTime = calculateElapsedTime(previousRMCTime, rmcTime);
            const waitTime = elapsedTime / speedFactor;
  
            const now = Date.now();
            const timeSinceLastSend = now - previousSendTime;
  
            if (timeSinceLastSend >= waitTime) {
              sendLine(line);
              previousRMCTime = rmcTime;
              previousSendTime = now;
            } else {
              setTimeout(() => handleLine(line), waitTime - timeSinceLastSend);
              return;
            }
          } else {
            previousRMCTime = rmcTime;
            previousSendTime = Date.now();
            sendLine(line);
          }
        } else {
          sendLine(line);
        }
      }
  
      function calculateElapsedTime(time1, time2) {
        const hours1 = parseInt(time1.substr(0, 2), 10);
        const minutes1 = parseInt(time1.substr(2, 2), 10);
        const seconds1 = parseInt(time1.substr(4, 2), 10);
  
        const hours2 = parseInt(time2.substr(0, 2), 10);
        const minutes2 = parseInt(time2.substr(2, 2), 10);
        const seconds2 = parseInt(time2.substr(4, 2), 10);
  
        const date1 = new Date(1970, 0, 1, hours1, minutes1, seconds1);
        const date2 = new Date(1970, 0, 1, hours2, minutes2, seconds2);
  
        return date2 - date1;
      }
  
      function sendLine(line) {
        app.debug(`Sending line to TCP server: ${line}`);
        client.write(line + '\n'); // Send to TCP server
      }
    };
  
    plugin.stop = function() {
      app.debug("Plugin stopped!");
      if (client) {
        client.end(() => {
          app.debug('Disconnected from TCP server');
        });
      }
    };
  
    return plugin;
  };
  