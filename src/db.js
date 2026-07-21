import mysql from 'mysql2/promise';
import 'dotenv/config';

//Pool MySQL con TiDB Cloud
export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'floripondia',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,     //mysql2 devuelve DATE como string
  decimalNumbers: true,  //mysql2 devuelve DECIMAL como numero
});

//Fecha Colombia (America/Bogota) en YYYY-MM-DD
export function hoyLocal() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts();
  const m = {};
  parts.forEach(p => m[p.type] = p.value);
  return `${m.year}-${m.month}-${m.day}`;
}
