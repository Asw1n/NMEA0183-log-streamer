// nmeaUtils.js

// file functions

const fs = require('fs');
const readline = require('readline');


async function getDateTimeRange(path) {
    let start = null;
    let end = null;

    try {
        // Check if the file exists and is readable
        await fs.promises.access(path, fs.constants.R_OK);

        const fileStream = fs.createReadStream(path);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });

        for await (const line of rl) {
            const date = getDate(line);
            if (date) {
                start = start ?? date;
                end = date;
            }
        }

        return {  start,  end };
    } catch (error) {
        throw new Error(`Failed to get date range from file: ${path}`);
    }
}



// line functions

/**
 * Validates if a line is a properly formatted NMEA0183 sentence.
 */
function validCheckSum(line) {
    const parts = line.split('*');
    if (parts.length !== 2) return false;

    const message = parts[0].substring(1); // Remove the starting '$'
    const checksum = parts[1];

    let calculatedChecksum = 0;
    for (let i = 0; i < message.length; i++) {
        calculatedChecksum ^= message.charCodeAt(i);
    }

    const hexChecksum = calculatedChecksum.toString(16).toUpperCase().padStart(2, '0');
    return hexChecksum === checksum;
}

function isAisMessage(line) {
    if (!line.startsWith('$AIVDM') && !line.startsWith('$AIVDO'))  return false;
    if (!validCheckSum(line)) return false;
    return true;
}


function isNmeaMessage(line) {
    if (!(line.startsWith('$') )) return false;
    if (!validCheckSum(line)) return false;
    return true;
}

/**
 * Converts an NMEA date/time to a JavaScript Date object.
 */
function toDate(time, datum) {
    const day = parseInt(datum.substr(0, 2), 10);
    const month = parseInt(datum.substr(2, 2), 10) - 1;
    const year = parseInt(datum.substr(4, 2), 10) + 2000;
    const hours = parseInt(time.substr(0, 2), 10);
    const minutes = parseInt(time.substr(2, 2), 10);
    const seconds = parseInt(time.substr(4, 2), 10);
    let milliseconds = parseInt(time.substr(7, 2), 10) * 10;
    if (isNaN(milliseconds)) milliseconds = 0;

    return new Date(Date.UTC(year, month, day, hours, minutes, seconds, milliseconds));
}

/**
 * Extracts a Date object from a nmea0183 line if possible. Otherwise return null.
 */
function getDate(line) {
    if (line.substr(3, 3) != "RMC") return null;
    const fields = line.split(',');
    if (!fields[1] || !fields[9]) return null;
    return toDate(fields[1], fields[9]);
}

module.exports = {
    getDate,
    getDateTimeRange,
    isNmeaMessage,
    isAisMessage,
    validCheckSum
};
