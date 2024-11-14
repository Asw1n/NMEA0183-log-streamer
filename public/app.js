// Base URL for the playback API
const API_BASE_URL = '/plugins/nmea-streamer';
const progressBar = document.getElementById('progressBar');
const markerStart = document.getElementById('markerStart');
const markerEnd = document.getElementById('markerEnd');
const markerCurrent = document.getElementById('markerCurrent');
const markerTarget = document.getElementById('markerTarget');
markerStart.endpoint = "setStart";
markerStart.position = 0;
markerEnd.endpoint = "setEnd";
markerEnd.position = 100;
markerCurrent.endpoint = "setCurrent";
markerCurrent.position = 0;
markerTarget.endpoint = "setTarget";
markerTarget.position = null;

const play = {
    markerCurrent: null,
    markerTarget: null,
    markerStart: null,
    markerEnd: null,
    speed: 1,
    status: "stopped"
};

const file = {
    baseName: null,
    path: null,
    start: null,
    end: null,
};


function enableDragging(marker) {
    marker.addEventListener('mousedown', (event) => {
        event.preventDefault();

        // Bind the onDrag function to this marker instance
        const onDragWithMarker = (e) => onDrag(e, marker);
        marker.currentPosition = 0;

        // Start dragging
        document.addEventListener('mousemove', onDragWithMarker);

        document.addEventListener('mouseup', () => {
            document.removeEventListener('mousemove', onDragWithMarker);
        }, { once: true });
    });
}


function onDrag(event, marker) {
    const barRect = progressBar.getBoundingClientRect();
    const barWidth = barRect.width;
    const offsetX = event.clientX - barRect.left;
    position = Math.min(100, Math.max(0, (offsetX / barWidth) * 100));
    //marker.style.left = `${position}%`;
    play[marker.id] = PercentageToDate(position);
    setPlay();


}


function dateToPercentage(date) {
    if (date === null) return null;
    return 100.0 * (date.getTime() - file.start.getTime()) / (file.end.getTime() - file.start.getTime());
}

function PercentageToDate(perc) {
    return new Date((perc / 100.0) * (file.end.getTime() - file.start.getTime()) + file.start.getTime());
}


function getFile() {
    getFromServer("getFile")
        .then(data => {
            file.baseName = data.baseName;
            file.path = data.path;
            file.start = new Date(data.start);
            file.end = new Date(data.end);
        })
        .catch(error => {
            console.error("Error while getting file", error);
        });
}

function getPlay() {
    getFromServer("getPlay")
        .then(data => {
            updatePlay(data);
            updateMarkers();
            updateStatus( play.status);
        })
        .catch(error => {
            console.error("Error while getting play", error);
        });
}

function setPlay() {
    const to = {
        status: play.status,
        speed: play.speed,
        markerTarget: play.markerTarget === null ? null : play.markerTarget.toISOString(),
        markerStart: play.markerStart === null ? null : play.markerStart.toISOString(),
        markerEnd: play.markerEnd === null ? null : play.markerEnd.toISOString()
    }
    postToServer("setPlay", to)
        .then(data => {
            updatePlay(data);
            updateMarkers();
            updateStatus( play.status);
        })
        .catch(error => {
            console.error("Error while setting play", error);
        });
}


function updatePlay(data) {
    play.status = data.status;
    play.speed = data.speed;
    play.markerCurrent = data.markerCurrent === null ? null : new Date(data.markerCurrent);
    play.markerTarget = data.markerTarget === null ? null : new Date(data.markerTarget);
    play.markerStart = data.markerStart === null ? null : new Date(data.markerStart);
    play.markerEnd = data.markerEnd === null ? null : new Date(data.markerEnd);
}

function updateMarkers() {
    placeMarker(markerStart, play.markerStart);
    placeMarker(markerEnd, play.markerEnd);
    placeMarker(markerCurrent, play.markerCurrent);
    placeMarker(markerTarget, play.markerTarget);
}

function placeMarker(marker, date) {
    if (date === null) {
        markerTarget.style.visibility = "hidden";
    }
    else {
        markerTarget.style.visibility = "visible";
        marker.style.left = `${dateToPercentage(date)}%`;
        marker.firstElementChild.innerHTML = date.toLocaleTimeString();
    }
}




async function postToServer(endpoint, value = null) {
    try {
        const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ value })
        });

        const data = await response.json();
        return data;
    } catch (error) {
        throw error; // Re-throw the error if needed
    }
}

async function getFromServer(endpoint) {
    try {
        const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        return data;
    } catch (error) {
        throw error; // Re-throw the error if needed
    }
}



function updateStatus(message) {
    document.getElementById('status').textContent = message;
}

function requestStatusUpdate() {
    getFromServer("status")
        .then(status => {
            // Update the UI with the current status
            markerCurrent.style.left = `${status.currentPosition}%`;
            markerCurrent.position = status.currentPosition;
            markerStart.style.left = `${status.loopStart}%`;
            markerStart.position = status.loopStart;
            markerEnd.style.left = `${status.loopEnd}%`;
            markerEnd.position = status.loopEnd;

            const speedselect = document.getElementById('speedSelect');
            speedselect.value = status.speed;

            const statusline = document.getElementById('status');
            statusline.textContent = status.status;
        })
        .catch(error => {
            console.error('Error fetching status from the server:', error);
        });
}

function update() {
    setInterval(() => {
        getPlay();
    }, 1000);
}
/*
progressBar.addEventListener('click', (event) => {
    if (event.offsetX) { //mouse drag interferes with click event, quick and dirty solution
        const barWidth = progressBar.offsetWidth;

        markerTarget.position = event.offsetX / barWidth * 100; // Get percentage
        postMarker(markerTarget);
        markerTarget.style.visibility = "visible";
        markerTarget.style.left = `${markerTarget.position}%`;
    }
});
*/

window.onload = () => {
    updateMarkers();
    enableDragging(markerStart);
    enableDragging(markerEnd);
    // Add event listeners to buttons
    document.getElementById('rewindButton').addEventListener('click', () => { play.markerTarget = play.markerStart; setPlay(); });
    document.getElementById('playButton').addEventListener('click', () => { play.status = "playing"; setPlay(); });
    document.getElementById('pauseButton').addEventListener('click', () => { play.status = "paused"; setPlay(); });
    document.getElementById('speedSelect').addEventListener('change', (event) => { play.speed = event.target.value; setPlay(); });
    getFile();
    update();
};
