The NMEA-streamer is a plugin for a SignalK server. It reads a file containing (previously recorded) NMEA messages and sends them to the SignalK server. The main feature of the plugin is its ability to stream the NMEA messages at a controlled speed. For this it uses time information from certain messages (RMC) in the file. The NMEA-streamer can be used to relive a sailing trip, to configure instrument displays or to develop plugins using real data.
<br><br>
How to configure the plugin and the SignalK server<br>
The plugin can be installed from the app store. It takes one parameters, filename.  <br>
A data connection must be available in the SignalK server to receive the data from the plugin. The data connection must be of type NMEA0183 and the data source of this connection must be TCP server on 10110.

<br><br>
The plugin has a web app to control the plugin. In the interface both the start and end position of the playable area can be altered, as well as they play speed. 