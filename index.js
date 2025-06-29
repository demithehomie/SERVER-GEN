const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3050;
const IS_TEST = process.env.NODE_ENV === 'test';

// Middleware para parsing JSON com limite de tamanho
app.use(express.json({ limit: '10mb' }));

// Middleware para CORS (se necessário para frontend)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Configuração da conexão PostgreSQL com melhor tratamento de erros
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false,
  connectionTimeoutMillis: 15000, // 15 segundos
  idleTimeoutMillis: 30000, // 30 segundos
  max: 20, // máximo de conexões no pool
  min: 2, // mínimo de conexões
  allowExitOnIdle: true
});

// Teste de conexão inicial com retry melhorado
const testConnection = async () => {
  const maxRetries = 5;
  let retries = maxRetries;
  
  while (retries > 0) {
    try {
      const client = await pool.connect();
      await client.query('SELECT NOW()'); // Teste simples
      console.log('✅ Conectado ao PostgreSQL com sucesso!');
      client.release();
      return true;
    } catch (err) {
      console.log(`❌ Tentativa de conexão falhou. Tentativas restantes: ${retries - 1}`);
      console.error('Erro:', err.message);
      retries--;
      
      if (retries > 0) {
        const delay = Math.min(1000 * (maxRetries - retries + 1), 10000); // Backoff exponencial
        console.log(`🔄 Tentando novamente em ${delay/1000} segundos...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error('❌ Não foi possível conectar ao PostgreSQL após todas as tentativas');
  console.log('📋 Verifique suas credenciais no arquivo .env');
  return false;
};

// Função utilitária para calcular média final com validação
const calculateFinalAverage = (firstSemester, secondSemester) => {
  const first = parseFloat(firstSemester);
  const second = parseFloat(secondSemester);
  
  if (isNaN(first) || isNaN(second)) {
    throw new Error('Notas devem ser números válidos');
  }
  
  return Math.round(((first + second) / 2) * 100) / 100; // Arredonda para 2 casas decimais
};

// Middleware para validação de UUID melhorado
const validateUUID = (req, res, next) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: 'ID é obrigatório' });
  }
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ error: 'ID deve ser um UUID válido' });
  }
  
  next();
};

// Middleware para validação de dados do participante
const validateParticipantData = (req, res, next) => {
  const { full_name, age, first_semester, second_semester } = req.body;
  const errors = [];
  
  // Validação de nome
  if (full_name !== undefined) {
    if (typeof full_name !== 'string' || full_name.trim().length === 0) {
      errors.push('full_name deve ser uma string não vazia');
    } else if (full_name.trim().length > 255) {
      errors.push('full_name deve ter no máximo 255 caracteres');
    }
  }
  
  // Validação de idade
  if (age !== undefined) {
    if (!Number.isInteger(age) || age <= 0 || age > 150) {
      errors.push('age deve ser um número inteiro entre 1 e 150');
    }
  }
  
  // Validação de notas
  if (first_semester !== undefined) {
    if (typeof first_semester !== 'number' || first_semester < 0 || first_semester > 10) {
      errors.push('first_semester deve ser um número entre 0 e 10');
    }
  }
  
  if (second_semester !== undefined) {
    if (typeof second_semester !== 'number' || second_semester < 0 || second_semester > 10) {
      errors.push('second_semester deve ser um número entre 0 e 10');
    }
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Dados inválidos', details: errors });
  }
  
  next();
};

// Middleware para logging de requisições
const requestLogger = (req, res, next) => {
  if (!IS_TEST) {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  }
  next();
};

app.use(requestLogger);

// ENDPOINTS CRUD

// GET /api/participants - Lista todos os participantes com paginação opcional
app.get('/api/participants', async (req, res) => {
  let client;
  try {
    // Parâmetros de paginação
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Máximo 100 por página
    const offset = (page - 1) * limit;
    
    // Parâmetros de ordenação
    const sortBy = req.query.sortBy || 'full_name';
    const sortOrder = req.query.sortOrder === 'desc' ? 'DESC' : 'ASC';
    const allowedSortFields = ['full_name', 'age', 'final_average', 'first_semester', 'second_semester'];
    
    if (!allowedSortFields.includes(sortBy)) {
      return res.status(400).json({ error: 'Campo de ordenação inválido' });
    }
    
    client = await pool.connect();
    
    // Query principal com paginação
    const query = `
      SELECT * FROM participants 
      ORDER BY ${sortBy} ${sortOrder} 
      LIMIT $1 OFFSET $2
    `;
    
    const result = await client.query(query, [limit, offset]);
    
    // Query para contar total de registros
    const countResult = await client.query('SELECT COUNT(*) FROM participants');
    const totalCount = parseInt(countResult.rows[0].count);
    
    res.status(200).json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Erro ao buscar participantes:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/participants/:id - Busca participante por ID
app.get('/api/participants/:id', validateUUID, async (req, res) => {
  let client;
  try {
    const { id } = req.params;
    
    client = await pool.connect();
    const result = await client.query('SELECT * FROM participants WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Participante não encontrado' });
    }
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar participante:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/participants - Cria novo participante
app.post('/api/participants', validateParticipantData, async (req, res) => {
  let client;
  try {
    const { full_name, age, first_semester, second_semester } = req.body;
    
    // Validação dos campos obrigatórios
    if (!full_name || age === undefined || first_semester === undefined || second_semester === undefined) {
      return res.status(400).json({ 
        error: 'Campos obrigatórios: full_name, age, first_semester, second_semester' 
      });
    }
    
    // Normaliza o nome
    const normalizedName = full_name.trim();
    
    // Calcula a média final
    let final_average;
    try {
      final_average = calculateFinalAverage(first_semester, second_semester);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    
    client = await pool.connect();
    
    // Verifica se já existe participante com o mesmo nome
    const existingCheck = await client.query(
      'SELECT id FROM participants WHERE LOWER(full_name) = LOWER($1)',
      [normalizedName]
    );
    
    if (existingCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe um participante com este nome' });
    }
    
    // Insere no banco de dados
    const result = await client.query(
      `INSERT INTO participants (id, full_name, age, first_semester, second_semester, final_average) 
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) 
       RETURNING *`,
      [normalizedName, age, first_semester, second_semester, final_average]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar participante:', error);
    if (error.code === '23505') { // Violação de constraint unique
      res.status(409).json({ error: 'Participante já existe' });
    } else {
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  } finally {
    if (client) client.release();
  }
});

// PUT /api/participants/:id - Atualiza participante existente
app.put('/api/participants/:id', validateUUID, validateParticipantData, async (req, res) => {
  let client;
  try {
    const { id } = req.params;
    const { full_name, age, first_semester, second_semester } = req.body;
    
    client = await pool.connect();
    
    // Verifica se o participante existe
    const existingParticipant = await client.query('SELECT * FROM participants WHERE id = $1', [id]);
    if (existingParticipant.rows.length === 0) {
      return res.status(404).json({ error: 'Participante não encontrado' });
    }
    
    const current = existingParticipant.rows[0];
    
    // Prepara os campos para atualização (mantém valores atuais se não fornecidos)
    const updatedName = full_name !== undefined ? full_name.trim() : current.full_name;
    const updatedAge = age !== undefined ? age : current.age;
    const updatedFirstSemester = first_semester !== undefined ? first_semester : current.first_semester;
    const updatedSecondSemester = second_semester !== undefined ? second_semester : current.second_semester;
    
    // Verifica se o novo nome já existe em outro participante
    if (full_name !== undefined && full_name.trim().toLowerCase() !== current.full_name.toLowerCase()) {
      const nameCheck = await client.query(
        'SELECT id FROM participants WHERE LOWER(full_name) = LOWER($1) AND id != $2',
        [updatedName, id]
      );
      
      if (nameCheck.rows.length > 0) {
        return res.status(409).json({ error: 'Já existe outro participante com este nome' });
      }
    }
    
    // Recalcula a média final
    let final_average;
    try {
      final_average = calculateFinalAverage(updatedFirstSemester, updatedSecondSemester);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    
    // Atualiza no banco de dados
    const result = await client.query(
      `UPDATE participants 
       SET full_name = $1, age = $2, first_semester = $3, second_semester = $4, final_average = $5 
       WHERE id = $6 
       RETURNING *`,
      [updatedName, updatedAge, updatedFirstSemester, updatedSecondSemester, final_average, id]
    );
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar participante:', error);
    if (error.code === '23505') {
      res.status(409).json({ error: 'Nome já existe para outro participante' });
    } else {
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  } finally {
    if (client) client.release();
  }
});

// DELETE /api/participants/:id - Remove participante
app.delete('/api/participants/:id', validateUUID, async (req, res) => {
  let client;
  try {
    const { id } = req.params;
    
    client = await pool.connect();
    const result = await client.query('DELETE FROM participants WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Participante não encontrado' });
    }
    
    res.status(204).send(); // No Content - sucesso sem retorno de dados
  } catch (error) {
    console.error('Erro ao deletar participante:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/health - Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message
    });
  }
});

// Middleware para rotas não encontradas
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Rota não encontrada',
    path: req.path,
    method: req.method
  });
});

// Middleware global de tratamento de erros
app.use((error, req, res, next) => {
  console.error('Erro não tratado:', error);
  
  // Erro de JSON malformado
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'JSON inválido no corpo da requisição' });
  }
  
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    timestamp: new Date().toISOString()
  });
});

// Inicia o servidor
if (!IS_TEST) {
  testConnection().then((connected) => {
    if (connected) {
      app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
        console.log(`📊 Health check disponível em http://localhost:${PORT}/api/health`);
      });
    } else {
      console.error('❌ Não foi possível iniciar o servidor devido a problemas de conexão');
      process.exit(1);
    }
  });
}

// Graceful shutdown melhorado
const gracefulShutdown = async (signal) => {
  console.log(`\n📡 Recebido sinal ${signal}. Encerrando servidor graciosamente...`);
  
  try {
    await pool.end();
    console.log('✅ Pool de conexões encerrado');
    console.log('👋 Servidor encerrado com sucesso');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro durante o encerramento:', error);
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

module.exports = app;

/*
MELHORIAS IMPLEMENTADAS:

1. 🔒 VALIDAÇÃO ROBUSTA:
   - Validação de UUID mais rigorosa
   - Validação de dados de entrada completa
   - Validação de limites (idade 1-150, notas 0-10)
   - Validação de tamanho de string (nome até 255 chars)

2. 🚀 PERFORMANCE:
   - Paginação para listagem de participantes
   - Ordenação configurável
   - Pool de conexões otimizado
   - Reuso de conexões

3. 🛡️ SEGURANÇA:
   - CORS configurado
   - Limite de tamanho de JSON
   - Validação contra SQL injection
   - Sanitização de entrada

4. 📊 RECURSOS ADICIONAIS:
   - Health check endpoint
   - Logging de requisições
   - Paginação na listagem
   - Verificação de nomes duplicados

5. 🔧 TRATAMENTO DE ERROS:
   - Tratamento específico por tipo de erro
   - Códigos HTTP apropriados (409 para conflitos)
   - Graceful shutdown melhorado
   - Tratamento de exceções não capturadas

6. 📐 CÁLCULOS:
   - Média arredondada para 2 casas decimais
   - Validação de números antes do cálculo

7. 🧪 COMPATIBILIDADE COM TESTES:
   - Melhores práticas para mocking
   - Conexões sempre liberadas (finally)
   - Variáveis de ambiente respeitadas

SETUP DO BANCO DE DADOS:
CREATE TABLE participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL UNIQUE,
  age INTEGER NOT NULL CHECK (age > 0 AND age <= 150),
  first_semester NUMERIC NOT NULL CHECK (first_semester >= 0 AND first_semester <= 10),
  second_semester NUMERIC NOT NULL CHECK (second_semester >= 0 AND second_semester <= 10),
  final_average NUMERIC NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_participants_name ON participants(full_name);
CREATE INDEX idx_participants_average ON participants(final_average);

NOVOS ENDPOINTS:
- GET /api/health - Status da aplicação
- GET /api/participants?page=1&limit=10&sortBy=full_name&sortOrder=asc

EXEMPLOS DE USO:
- GET /api/participants?page=2&limit=5&sortBy=final_average&sortOrder=desc
- GET /api/health
*/