const mqtt = require('mqtt');
const http = require('http');
const amqp = require('amqplib');
const url = require('url');
const querystring = require('querystring');
const { Pool } = require('pg');

//Wenn richtige Mac-Adresse verwendet werden soll kommentieren:
const num1 = parseInt(process.env.NUM1) || 1;
const num2 = parseInt(process.env.NUM2) || 1;
const num3 = parseInt(process.env.NUM3) || 1;

//Wenn richtige Mac-Adresse verwendet werden soll auskommentieren:
//const os = require('os');
//const networkInterfaces = os.networkInterfaces();
//const uuid = networkInterfaces['WLAN'][0].mac; // Replace 'eth0' with your desired network interface

const uuid = `a${num1}:6d:aa:${num2}1:${num3}4:ca`


/** PostgreSQL **/

const pgConfig = {
  user: 'admin',
  password: 'admin',
  host: '192.168.178.75',
  port: 5432,
  database: 'ueberwachungbuffet'
};

const pool = new Pool(pgConfig);


// Überprüfen, ob Tabelle existiert und erstellen, falls nicht
async function checkAndCreateTable() {
  try {
    const client = await pool.connect();

    // Überprüfen, ob Tabelle existiert
    const checkTableQuery = "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'uuidedgedevices')";
    const result = await client.query(checkTableQuery);

    if (!result.rows[0].exists) {
      // Tabelle existiert nicht, sie erstellen
      const createTableQuery = `
        CREATE TABLE uuidedgedevices (
          id SERIAL PRIMARY KEY,
          uuid TEXT NOT NULL,
          buffetid TEXT,
          buffetname TEXT,
          chafingdishid TEXT
        )
      `;
      await client.query(createTableQuery);
      console.log('Die Tabelle "uuidedgedevices" wurde erstellt.');
    }

    // Prüfen, ob  Wert bereits in der Tabelle
    const checkValueQuery = "SELECT EXISTS (SELECT FROM uuidedgedevices WHERE uuid = $1)";
    const valueResult = await client.query(checkValueQuery, [uuid]);

    if (!valueResult.rows[0].exists) {
      // Wert in Tabelle einfügen
      const insertQuery = `
        INSERT INTO uuidedgedevices (uuid) VALUES ($1)
      `;
      await client.query(insertQuery, [uuid]);
      console.log('Der Eintrag wurde hinzugefügt.');
    } else {
      console.log('Der Wert existiert bereits in der Tabelle.');
    }
    client.release();
  } catch (error) {
    console.error('Fehler bei der Ausführung des Skripts:', error);
  } 
}

checkAndCreateTable();

async function insertIntoTable(buffetid, buffetname, chafingdishid) {
  try {
    const client = await pool.connect();
    const checkValueQuery = "SELECT EXISTS (SELECT FROM uuidedgedevices WHERE uuid = $1)";
    const valueResult = await client.query(checkValueQuery, [uuid]);

    if (!valueResult.rows[0].exists) {
      const insertQuery = `
        INSERT INTO uuidedgedevices (uuid) VALUES ($1)
      `;
      await client.query(insertQuery, [uuid]);
      console.log('Die UUID ist nicht zu finden in der DB, füge hinzu und probiere erneut..');

      insertIntoTable(buffetid, buffetname, chafingdishid);
    } else {

      const query = 'UPDATE uuidedgedevices SET buffetid = $1, buffetname = $2, chafingdishid = $3 WHERE uuid = $4';
      await client.query(query, [buffetid, buffetname, chafingdishid, uuid]);

      console.log('UUID in DB gefunden..');
      console.log(`Das Buffet ${buffetid} unter dem Namen ${buffetname} mit der Chafing-Dish ${chafingdishid} wurde der DB unter der eigenen UUID hinzugefügt.`);
    }

    client.release();
  } catch (error) {
    console.error('Fehler bei der Ausführung des Skripts:', error);
  }
}


async function getFromTable() {
  try {
    const client = await pool.connect();
    const checkValueQuery = "SELECT buffetid, buffetname, chafingdishid FROM uuidedgedevices WHERE uuid = $1";
    const valueResult = await client.query(checkValueQuery, [uuid]);
    console.log(valueResult.rows[0]);
    client.release();
    if (valueResult.rows[0] == null) {
      return null;
    } else {
      return valueResult.rows[0];
    }    
  } catch (error) {
    console.error('Fehler bei der Ausführung des Skripts:', error);
  }
}

/* Webserver */
const server = http.createServer(async (req, res) => {
  const reqUrl = url.parse(req.url);
  const reqPath = reqUrl.pathname;
  const reqQuery = querystring.parse(reqUrl.query);


  if (req.method === 'POST' && reqPath === '/buffet') {
    const { buffetId, buffetName, chafingDishId} = reqQuery;

    insertIntoTable(buffetId, buffetName, chafingDishId);
    sendToBuffet(buffetId, buffetName, chafingDishId);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Daten erfolgreich empfangen und verarbeitet.');
  } else if (req.method === 'GET' && reqPath === '/buffet') {
    
    var result = await getFromTable();
    var buffetData;

    if(result["buffetid"] != null){
      buffetData = {
        buffetId: result["buffetid"],
        buffetName: result["buffetname"],
        chafingDishId: result["chafingdishid"]
      };
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(buffetData));
    } else {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('404 - Not Found');
    }

  } else {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('404 - Not Found');
  }
});

/* RabbitMQ */
const rabbitMQHost = '192.168.178.75';
const rabbitMQPort = 5672;
const rabbitMQUsername = 'admin';
const rabbitMQPassword = 'rabbitmq';

const exchangeName = uuid;
const routingKey = uuid;

var konfig = null;

async function sendToBuffet(buffetId, buffetName, chafingDishId){
  try {
    const connection = await amqp.connect(`amqp://${rabbitMQUsername}:${rabbitMQPassword}@${rabbitMQHost}:${rabbitMQPort}`);
    const channel = await connection.createChannel();
    
    const message = JSON.stringify({ payload: 'Ueberwachung Edge wurde einem Buffet & Chafing zugewiesen.', uuid: uuid, buffetId: buffetId, buffetName: buffetName, chafingDishId, chafingDishId });
    channel.publish("Buffet", "Buffet", Buffer.from(message));
    
    console.log('Nachricht veröffentlicht:', message);
    
    await channel.close();
    await connection.close();
  } catch (error) {
    console.error('Fehler beim Veröffentlichen der Nachricht:', error);
  }
}

async function start() {
  while (true) {
    try {
      const connection = await amqp.connect(`amqp://${rabbitMQUsername}:${rabbitMQPassword}@${rabbitMQHost}:${rabbitMQPort}`);
      const channel = await connection.createChannel();
      await channel.assertExchange(exchangeName, 'direct', { durable: false });
      const { queue } = await channel.assertQueue('', { exclusive: true });
      await channel.bindQueue(queue, exchangeName, routingKey);
      
      channel.consume(queue, (msg) => {
        konfig = JSON.parse(msg.content);
        console.log('Konfiguration empfangen:', konfig);
        if(intervalId != null) {
          clearInterval(intervalId);
          client.end();
          startToOperate();
        }
      }, { noAck: true });
      
      console.log('Warte auf Konfiguration..');
      break;
    } catch (error) {
      console.error('Fehler beim Verbinden zu RabbitMQ:', error);
      await new Promise(resolve => setTimeout(resolve, 20000)); 
    }
  }
}

start();

async function noKonfig() {
  while (true) {
    try {
      const connection = await amqp.connect(`amqp://${rabbitMQUsername}:${rabbitMQPassword}@${rabbitMQHost}:${rabbitMQPort}`);
      const channel = await connection.createChannel();

      const message = JSON.stringify({ payload: 'Keine Konfiguration vorhanden.', uuid: uuid });
      channel.publish("Konfiguration", "Konfiguration", Buffer.from(message));

      console.log('Nachricht veröffentlicht:', message);

      await channel.close();
      await connection.close();
      break; // Verbindung erfolgreich, Schleife beenden
    } catch (error) {
      console.error('Fehler beim Veröffentlichen der Nachricht:', error);
      await new Promise(resolve => setTimeout(resolve, 20000));
    }
  }
}

/*MQTT*/
var topic;
var willTopic;
const brokerUrl = 'mqtt://192.168.178.75:1883';
const willMessage = 'Verbindung zum Broker verloren';
var veranstaltung;
var client;
var intervalId = null;

function startToOperate(){
  if(konfig === null){
    noKonfig();
    console.log("Probiere bei keiner Antwort in 60 Sekunden erneut..")
    setTimeout(() => {
      startToOperate()
    }, 60000);
  } else {
    veranstaltung = konfig.Veranstaltung

    topic = `veranstaltung/${konfig.Veranstaltung}/buffet/${konfig.Buffet}/chafingdish/${konfig.Chafingdish}`;
    willTopic = 'error/ueberwachungedge/'+ topic;
    client = mqtt.connect(brokerUrl, {
      will: {
        topic: willTopic,
        payload: willMessage
      }
    });

    client.on('connect', () => {
      console.log('Verbunden mit dem MQTT-Broker');

      intervalId = setInterval(publishData, 1000);
    });   
  }
}

startToOperate();

//topic = inhouse/buffet/1/chafingdish/9/food/spätzle
//var topics = ['Zwiebelrostbraten', 'Schweinenacken', 'Gemüseschnitzel', 'Spätzle', 'Pommes Frittes', 'Käsespätzle', 'Marktgemüse' , 'Spargel', 'Babykartoffeln'];

const initialTemperature = 90; 
//const finalTemperature = 20; 
const temperatureStep = 0.7; 
const initialWeight = 10; 
const finalWeight = 0.5; 
const weightStep = 0.2; 
const resetWeight = 10; 

let currentTemperature = initialTemperature;
let currentWeight = initialWeight;


function publishData() {

  const data = {
    food: konfig.Gericht,
    temperature: currentTemperature,
    weight: currentWeight
  };
  client.publish(topic, JSON.stringify(data), { qos: 0, retain: false });
  console.log(topic + `: Das Gericht ${konfig.Gericht} hat eine Temperatur von ${currentTemperature} Grad Celsius und ein Gewicht von ${currentWeight} kg.`);

  if (currentWeight < finalWeight) {
    currentWeight = resetWeight;
    currentTemperature = initialTemperature;
  } else {
    currentWeight -= weightStep;
    currentWeight = currentWeight.toFixed(2);
    currentTemperature -= temperatureStep;
    currentTemperature = currentTemperature.toFixed(2);
  }
}

/*HTTP-Server starten*/ 
const port = 3*1000+num1*100+num2*10+num3;
server.listen(port, () => {
  console.log(`HTTP-Server gestartet. Listening on port ${port}`);
});
