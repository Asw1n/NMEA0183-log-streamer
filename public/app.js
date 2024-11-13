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
    marker.position = Math.min(100, Math.max(0, (offsetX / barWidth) * 100));
    marker.style.left = `${marker.position}%`;
    postMarker(marker);
}

async function sendControlRequest(endpoint) {
    postToServer(endpoint)
        .then(status => {
            const statusline = document.getElementById('status');
            statusline.textContent = status.status;
        })
        .catch(error => {
            console.error("Error while sending control", error);
        });
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

function postMarker(marker) {
    postToServer(marker.endpoint, marker.position)
        .then(data => {
            // Handle the returned data here
            marker.style.left = `${data.percentage}%`;
            marker.style.display = 'block';
            const tooltip = marker.firstElementChild;
            if (tooltip !== null) {
                tooltip.innerHTML = data.date;
            }
        })
        .catch(error => {
            console.error("Error while setting marker", error);
        });
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

function updateCurrent() {
    setInterval(() => {
        getFromServer("getCurrent")
            .then(data => {
                markerCurrent.style.left = `${data.percentage}%`;
                markerCurrent.position = data.percentage;
                markerCurrent.firstElementChild.innerHTML = data.date;
            })
            .catch(error => {
                console.error('Error fetching current position from the server:', error);
            });
            getFromServer("getTarget")
            .then(data => {
                if (data.percentage !== null) {
                markerTarget.style.left = `${data.percentage}%`;
                markerCurrent.position = data.percentage;
                markerCurrent.firstElementChild.innerHTML = data.date;
                markerTarget.style.visibility= "visible";
                }
                else {
                  markerTarget.style.visibility= "hidden"; 
                }
            })
            .catch(error => {
                console.error('Error fetching current position from the server:', error);
            });
    }, 1000);
}

progressBar.addEventListener('click', (event) => {
    const barWidth = progressBar.offsetWidth;
    markerTarget.position = event.offsetX / barWidth * 100; // Get percentage
    postMarker(markerTarget);
    markerTarget.style.visibility = "visible";
    markerTarget.style.left = `${markerTarget.position}%`;
});

window.onload = () => {
    enableDragging(markerStart);
    enableDragging(markerEnd);
    // Add event listeners to buttons
    document.getElementById('rewindButton').addEventListener('click', () => sendControlRequest('rewind'));
    document.getElementById('playButton').addEventListener('click', () => sendControlRequest('play'));
    document.getElementById('pauseButton').addEventListener('click', () => sendControlRequest('pause'));
    // Handle play speed changes
    document.getElementById('speedSelect').addEventListener('change', (event) => {
        const speed = event.target.value;
        postToServer(`setSpeed`, parseFloat(speed))
            .then(data => {
                
            })
            .catch(error => {
                console.error("Error while sending control", error);
            });
    });
    requestStatusUpdate();
    updateCurrent();
};
