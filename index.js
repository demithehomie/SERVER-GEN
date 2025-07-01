const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { v4: uuid } = require('uuid');
require('dotenv').config();
console.log('🛠️  DB config:',
  {
    user:     process.env.DB_USER,
    host:     process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD ? '****' : null,
    port:     process.env.DB_PORT,
  }
);

const app = express();
const PORT = process.env.PORT || 3050;

// Configuração do banco PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'participants_db',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
  ssl: {
    // Desativa checagem de certificado — útil para conexões gerenciadas como a da Render
    rejectUnauthorized: false
  }
});

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// GET /api/participants
app.get('/api/participants', async (req, res) => {
  console.log('[GET /api/participants] início da requisição. Query:', req.query);
  try {
    const { rows } = await pool.query('SELECT * FROM participants ORDER BY full_name');
    console.log('[GET] retornando', rows.length, 'participantes');
    return res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /api/participants] erro:', err);
    return res.status(500).json({ error: 'Erro ao listar participantes' });
  }
});

// GET /api/participants/:id
app.get('/api/participants/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`[GET /api/participants/${id}] buscando participante`);
  try {
    const { rows } = await pool.query('SELECT * FROM participants WHERE id = $1', [id]);
    if (!rows.length) {
      console.warn(`[GET /api/participants/${id}] não encontrado`);
      return res.status(404).json({ error: 'Participante não encontrado' });
    }
    return res.status(200).json(rows[0]);
  } catch (err) {
    console.error(`[GET /api/participants/${id}] erro:`, err);
    return res.status(500).json({ error: 'Erro ao buscar participante' });
  }
});

// POST /api/participants
app.post('/api/participants', async (req, res) => {
  console.log('[POST /api/participants] body:', req.body);
  const { full_name, age, first_semester, second_semester } = req.body;
  if (!full_name || age == null || first_semester == null || second_semester == null) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  const final_average = ((Number(first_semester) + Number(second_semester)) / 2).toFixed(2);
  const id = uuid();

  try {
    const { rows } = await pool.query(
      `INSERT INTO participants (id, full_name, age, first_semester, second_semester, final_average)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, full_name.trim(), age, first_semester, second_semester, final_average]
    );
    console.log('[POST] criado participante com id:', id);
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /api/participants] erro:', err);
    return res.status(500).json({ error: 'Erro ao criar participante' });
  }
});

// PUT /api/participants/:id
app.put('/api/participants/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`[PUT /api/participants/${id}] body:`, req.body);
  const { full_name, age, first_semester, second_semester } = req.body;

  try {
    // busca atual
    const { rows } = await pool.query('SELECT * FROM participants WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Participante não encontrado' });

    // prepara atualização
    const current = rows[0];
    const updated = {
      full_name: full_name ?? current.full_name,
      age:        age        ?? current.age,
      first_semester: first_semester ?? current.first_semester,
      second_semester: second_semester ?? current.second_semester,
    };
    updated.final_average = ((Number(updated.first_semester) + Number(updated.second_semester)) / 2).toFixed(2);

    const { rows: upRows } = await pool.query(
      `UPDATE participants
         SET full_name=$1, age=$2, first_semester=$3, second_semester=$4, final_average=$5
       WHERE id=$6 RETURNING *`,
      [
        updated.full_name.trim(),
        updated.age,
        updated.first_semester,
        updated.second_semester,
        updated.final_average,
        id
      ]
    );
    console.log(`[PUT] participante ${id} atualizado`);
    return res.status(200).json(upRows[0]);
  } catch (err) {
    console.error(`[PUT /api/participants/${id}] erro:`, err);
    return res.status(500).json({ error: 'Erro ao atualizar participante' });
  }
});

// DELETE /api/participants/:id
app.delete('/api/participants/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`[DELETE /api/participants/${id}] removendo participante`);
  try {
    const { rowCount } = await pool.query('DELETE FROM participants WHERE id = $1', [id]);
    if (!rowCount) {
      console.warn(`[DELETE /api/participants/${id}] nada foi removido`);
      return res.status(404).json({ error: 'Participante não encontrado' });
    }
    console.log(`[DELETE] participante ${id} removido`);
    return res.sendStatus(204);
  } catch (err) {
    console.error(`[DELETE /api/participants/${id}] erro:`, err);
    return res.status(500).json({ error: 'Erro ao remover participante' });
  }
});

// Rota de health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Rota raiz
app.get('/', (req, res) => {
  res.status(200).json({ 
    message: 'API de Participantes funcionando!', 
    endpoints: [
      'GET /api/participants - Listar todos os participantes',
      'GET /api/participants/:id - Buscar participante por ID',
      'POST /api/participants - Criar novo participante',
      'PUT /api/participants/:id - Atualizar participante',
      'DELETE /api/participants/:id - Remover participante',
      'GET /health - Status da API'
    ]
  });
});

// Middleware de tratamento de erros
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// Função para inicializar o banco
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS participants (
        id VARCHAR(36) PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        age INTEGER NOT NULL,
        first_semester DECIMAL(4,2) NOT NULL,
        second_semester DECIMAL(4,2) NOT NULL,
        final_average DECIMAL(4,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabela participants criada/verificada com sucesso');
  } catch (err) {
    console.error('❌ Erro ao inicializar banco:', err);
    process.exit(1);
  }
}

// Inicializar servidor
async function startServer() {
  try {
    // Testar conexão com banco
    await pool.query('SELECT NOW()');
    console.log('✅ Conexão com PostgreSQL estabelecida');
    
    // Inicializar banco
    await initializeDatabase();
    
    // Iniciar servidor
    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      console.log(`📋 Endpoints disponíveis:`);
      console.log(`   GET    http://localhost:${PORT}/api/participants`);
      console.log(`   GET    http://localhost:${PORT}/api/participants/:id`);
      console.log(`   POST   http://localhost:${PORT}/api/participants`);
      console.log(`   PUT    http://localhost:${PORT}/api/participants/:id`);
      console.log(`   DELETE http://localhost:${PORT}/api/participants/:id`);
      console.log(`   GET    http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error('❌ Erro ao iniciar servidor:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Finalizando servidor...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Finalizando servidor...');
  await pool.end();
  process.exit(0);
});

// Iniciar aplicação
startServer();