const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');

// Mock do módulo pg
// ⬇ participants.test.js (antes da importação do index.js)
// Atualize o mock do pg para ser mais específico
jest.mock('pg', () => {
  const mClient = {
    query: jest.fn(),
    release: jest.fn()
  };
  const mPool = {
    connect: jest.fn().mockResolvedValue(mClient),
    query: jest.fn(),
    end: jest.fn()
  };
  return { Pool: jest.fn(() => mPool) };
});

// Mock do dotenv
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

// Importa a aplicação após os mocks
let app;
let mockPool;

beforeAll(() => {
    process.env.NODE_ENV = 'test';
  // Mock das variáveis de ambiente
  process.env.DB_HOST = 'dpg-d1gbfjemcj7s73cj2gd0-a.oregon-postgres.render.com';
  process.env.DB_PORT = '5432';
  process.env.DB_USER = 'gen';
  process.env.DB_PASSWORD = 'ib9heqTMwAMq8Ac90ecJ2dJwSJ5yAJRy';
  process.env.DB_NAME = 'gen_f3no';
  process.env.PORT = '3000';

  // Recria a aplicação com os mocks
  jest.resetModules();
  mockPool = new Pool();
  
  // Mock da conexão inicial
  mockPool.connect.mockImplementation((callback) => {
    callback(null, {}, () => {});
  });

  app = require('./index');
});

describe('Participants API Tests', () => {
  
 beforeEach(() => {
  // Limpar todos os mocks
  jest.clearAllMocks();
  
  // Configurar o mock padrão para queries
  mockPool.query.mockResolvedValue({ rows: [] });
  
  // Configurar o mock para a conexão
  mockPool.connect.mockResolvedValue({
    query: jest.fn(),
    release: jest.fn()
  });
});

  describe('GET /api/participants', () => {
    it('deve retornar lista de participantes', async () => {
      const mockParticipants = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          full_name: 'João Silva',
          age: 25,
          first_semester: 8.5,
          second_semester: 7.5,
          final_average: 8.0
        }
      ];

      mockPool.query.mockResolvedValueOnce({ rows: mockParticipants });

      const response = await request(app)
        .get('/api/participants')
        .expect(200);

      expect(response.body).toEqual(mockParticipants);
      expect(mockPool.query).toHaveBeenCalledWith('SELECT * FROM participants ORDER BY full_name');
    });

    it('deve retornar erro 500 em caso de falha no banco', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/api/participants')
        .expect(500);

      expect(response.body).toEqual({ error: 'Erro interno do servidor' });
    });
  });

  describe('GET /api/participants/:id', () => {
    const validId = '123e4567-e89b-12d3-a456-426614174000';
    const invalidId = 'invalid-uuid';

    it('deve retornar participante por ID válido', async () => {
      const mockParticipant = {
        id: validId,
        full_name: 'João Silva',
        age: 25,
        first_semester: 8.5,
        second_semester: 7.5,
        final_average: 8.0
      };

      mockPool.query.mockResolvedValueOnce({ rows: [mockParticipant] });

      const response = await request(app)
        .get(`/api/participants/${validId}`)
        .expect(200);

      expect(response.body).toEqual(mockParticipant);
    });

    it('deve retornar erro 400 para ID inválido', async () => {
      const response = await request(app)
        .get(`/api/participants/${invalidId}`)
        .expect(400);

      expect(response.body).toEqual({ error: 'ID deve ser um UUID válido' });
    });

    it('deve retornar erro 404 quando participante não existir', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get(`/api/participants/${validId}`)
        .expect(404);

      expect(response.body).toEqual({ error: 'Participante não encontrado' });
    });
  });

  describe('POST /api/participants', () => {
    const validParticipant = {
      full_name: 'Maria Santos',
      age: 22,
      first_semester: 9.0,
      second_semester: 8.5
    };

    it('deve criar participante com dados válidos', async () => {
      const mockCreatedParticipant = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        ...validParticipant,
        final_average: 8.75
      };

      mockPool.query.mockResolvedValueOnce({ rows: [mockCreatedParticipant] });

      const response = await request(app)
        .post('/api/participants')
        .send(validParticipant)
        .expect(201);

      expect(response.body).toEqual(mockCreatedParticipant);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO participants'),
        expect.arrayContaining([
          validParticipant.full_name,
          validParticipant.age,
          validParticipant.first_semester,
          validParticipant.second_semester,
          8.75 // média calculada
        ])
      );
    });

    it('deve retornar erro 400 quando campos obrigatórios estiverem ausentes', async () => {
      const invalidParticipant = {
        full_name: 'João',
        age: 25
        // faltam first_semester e second_semester
      };

      const response = await request(app)
        .post('/api/participants')
        .send(invalidParticipant)
        .expect(400);

      expect(response.body.error).toContain('Campos obrigatórios');
    });

    it('deve retornar erro 400 para idade inválida', async () => {
      const invalidParticipant = {
        ...validParticipant,
        age: -5
      };

      const response = await request(app)
        .post('/api/participants')
        .send(invalidParticipant)
        .expect(400);

      expect(response.body).toEqual({ error: 'Age deve ser um número positivo' });
    });

    it('deve retornar erro 400 para notas inválidas', async () => {
      const invalidParticipant = {
        ...validParticipant,
        first_semester: 'não é número'
      };

      const response = await request(app)
        .post('/api/participants')
        .send(invalidParticipant)
        .expect(400);

      expect(response.body).toEqual({ error: 'Notas devem ser números' });
    });
  });

  describe('PUT /api/participants/:id', () => {
    const validId = '123e4567-e89b-12d3-a456-426614174000';
    const existingParticipant = {
      id: validId,
      full_name: 'João Silva',
      age: 25,
      first_semester: 8.5,
      second_semester: 7.5,
      final_average: 8.0
    };

    it('deve atualizar participante existente', async () => {
      const updateData = {
        full_name: 'João Santos Silva',
        age: 26
      };

      const updatedParticipant = {
        ...existingParticipant,
        ...updateData,
        final_average: 8.0 // recalculada
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [existingParticipant] }) // SELECT existente
        .mockResolvedValueOnce({ rows: [updatedParticipant] }); // UPDATE

      const response = await request(app)
        .put(`/api/participants/${validId}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toEqual(updatedParticipant);
    });

    it('deve retornar erro 404 para participante inexistente', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .put(`/api/participants/${validId}`)
        .send({ full_name: 'Novo Nome' })
        .expect(404);

      expect(response.body).toEqual({ error: 'Participante não encontrado' });
    });

    it('deve recalcular média quando notas são atualizadas', async () => {
      const updateData = {
        first_semester: 9.0,
        second_semester: 9.5
      };

      const updatedParticipant = {
        ...existingParticipant,
        ...updateData,
        final_average: 9.25
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [existingParticipant] })
        .mockResolvedValueOnce({ rows: [updatedParticipant] });

      const response = await request(app)
        .put(`/api/participants/${validId}`)
        .send(updateData)
        .expect(200);

      expect(response.body.final_average).toBe(9.25);
    });
  });

  describe('DELETE /api/participants/:id', () => {
    const validId = '123e4567-e89b-12d3-a456-426614174000';

    it('deve deletar participante existente', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: validId }] });

      const response = await request(app)
        .delete(`/api/participants/${validId}`)
        .expect(204);

      expect(response.body).toEqual({});
      expect(mockPool.query).toHaveBeenCalledWith(
        'DELETE FROM participants WHERE id = $1 RETURNING id',
        [validId]
      );
    });

    it('deve retornar erro 404 para participante inexistente', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .delete(`/api/participants/${validId}`)
        .expect(404);

      expect(response.body).toEqual({ error: 'Participante não encontrado' });
    });
  });

  describe('Rotas não encontradas', () => {
    it('deve retornar erro 404 para rota inexistente', async () => {
      const response = await request(app)
        .get('/api/rota-inexistente')
        .expect(404);

      expect(response.body).toEqual({ error: 'Rota não encontrada' });
    });
  });

  describe('Validação de UUID', () => {
    const invalidUUIDs = [
      'invalid-uuid',
      '123',
      'abc-def-ghi',
      '123e4567-e89b-12d3-a456-42661417400', // muito curto
      '123e4567-e89b-12d3-a456-426614174000x' // muito longo
    ];

    invalidUUIDs.forEach(invalidId => {
      it(`deve rejeitar UUID inválido: ${invalidId}`, async () => {
        const response = await request(app)
          .get(`/api/participants/${invalidId}`)
          .expect(400);

        expect(response.body).toEqual({ error: 'ID deve ser um UUID válido' });
      });
    });
  });

  describe('Cálculo de média', () => {
    it('deve calcular média corretamente', async () => {
      const participantData = {
        full_name: 'Teste Média',
        age: 20,
        first_semester: 7.5,
        second_semester: 8.5
      };

      const expectedAverage = (7.5 + 8.5) / 2; // 8.0

      const mockCreatedParticipant = {
        id: '123e4567-e89b-12d3-a456-426614174002',
        ...participantData,
        final_average: expectedAverage
      };

      mockPool.query.mockResolvedValueOnce({ rows: [mockCreatedParticipant] });

      const response = await request(app)
        .post('/api/participants')
        .send(participantData)
        .expect(201);

      expect(response.body.final_average).toBe(expectedAverage);
    });
  });
});

// Cleanup após todos os testes
afterAll(async () => {
  if (mockPool && mockPool.end) {
    await mockPool.end();
  }
});