/* jshint esversion: 6 */
/* global __dirname, Promise */
(() => {
  'use strict';
  
  const _ = require('lodash');
  const async = require('async');
  const util = require('util');
  const Promise = require('bluebird');
  
  class Models {
    
    constructor (logger, shadySequelize) {
      this.logger = logger;
      this.sequelize = shadySequelize.sequelize;
      this.Sequelize = shadySequelize.Sequelize;
      this.defineModels();
    }
    
    defineModels() {
      const Sequelize = this.Sequelize;
      
      this.defineModel('ConnectSession', {
        sid: {
          type: Sequelize.STRING,
          primaryKey: true
        },
        userId: Sequelize.STRING,
        expires: Sequelize.DATE,
        data: Sequelize.TEXT
      });
      
      this.defineModel('Query', {
        id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false },
        start: { type: Sequelize.DATE },
        end: { type: Sequelize.DATE },
        name: { type: Sequelize.STRING },
        labelx: { type: Sequelize.STRING },
        labely: { type: Sequelize.STRING },
        thesis: { type: 'LONGTEXT', allowNull: false },
        type: { type: Sequelize.STRING, allowNull: false }
      });
      
      this.defineModel('QueryEditor', {
        id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false },
        queryId: { type: Sequelize.BIGINT, allowNull: false, references: { model: this.Query, key: 'id' } },
        userId: { type: Sequelize.STRING, allowNull: false, validate: { isUUID: 4 }  },
        role: { type: Sequelize.STRING, allowNull: false }
      }, {
        indexes: [{
          name: 'UN_QUERYEDITOR_QUERYID_USER_ID',
          unique: true,
          fields: ['queryId', 'userId']
        }]
      });
      
      this.defineModel('QueryUser', {
        id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false },
        queryId: { type: Sequelize.BIGINT, allowNull: false, references: { model: this.Query, key: 'id' } },
        userId: { type: Sequelize.STRING, validate: { isUUID: 4 }  }
      }, {
        indexes: [{
          name: 'UN_QUERYUSER_QUERYID_USER_ID',
          unique: true,
          fields: ['queryId', 'userId']
        }]
      });
      
      this.defineModel('Session', {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
        userId: { type: Sequelize.STRING, validate: { isUUID: 4 } },
        queryUserId: { type: Sequelize.BIGINT, references: { model: this.QueryUser, key: 'id' } }
      });
      
      this.defineModel('Answer', {
        id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false },
        queryUserId: { type: Sequelize.BIGINT, allowNull: false, references: { model: this.QueryUser, key: 'id' } },
        x: { type: Sequelize.DOUBLE },
        y: { type: Sequelize.DOUBLE }
      });
      
      this.defineModel('Comment', {
        id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false },
        isRootComment: { type: Sequelize.BOOLEAN, allowNull: false },
        parentCommentId: { type: Sequelize.BIGINT, references: { model: 'Comments', key: 'id' } },
        queryUserId: { type: Sequelize.BIGINT, allowNull: false, references: { model: this.QueryUser, key: 'id' } },
        queryId: { type: Sequelize.BIGINT, allowNull: false, references: { model: this.Query, key: 'id' } },
        comment: { type: Sequelize.TEXT, allowNull: false },
        x: { type: Sequelize.DOUBLE },
        y: { type: Sequelize.DOUBLE }
      });
    }
    
    defineModel(name, attributes, options) {
      this[name] = this.sequelize.define(name, attributes, options);
      this[name].sync();
    }
    
    // Sessions
    
    createSession(userId) {
      return this.sequelize.sync()
        .then(() => this.Session.create({
          userId: userId
      }));
    }
    
    findSession(id) {
      return this.Session.findOne({ where: { id : id } });
    }
    
    updateSessionQueryUserId(sessionId, queryUserId) {
      return this.Session.update({
        queryUserId: queryUserId
      }, {
        where: {
          id: sessionId
        }
      });
    }
    
    deleteSession(id) {
      return this.Session.destroy({ where: { id : id } });
    }
    
    // Queries
    
    createQuery(start, end, name, thesis, labelx, labely, type) {
      return this.sequelize.sync()
        .then(() => this.Query.create({
          start: start,
          end: end,
          name: name,
          thesis: thesis,
          labelx: labelx,
          labely: labely,
          type: type
      }));
    }
    
    findQuery(id) {
      return this.Query.findOne({ where: { id : id } });
    }
    
    listQueriesCurrentlyInProgress() {
      const now = new Date();
      return this.Query.findAll({ where: { start: { $lte: now }, end: { $gte: now } }, order: [ [ 'start', 'DESC' ] ]});
    }
    
    listEndedQueries() {
      const now = new Date();
      return this.Query.findAll({ where: { start: { $lte: now }, end: { $lte: now } }, order: [ [ 'start', 'DESC' ] ]});
    }
    
    listQueriesByEditorUserId(userId) {
      const attributes = [ [ this.Sequelize.fn('DISTINCT', this.Sequelize.col('queryId')) ,'queryId'] ];
      return this.QueryEditor.findAll({ attributes: attributes }, { where: { userId: userId } })
        .then((result) => {
          const queryIds = _.map(result, 'queryId');
           return this.Query.findAll({ where: { id: { $in: queryIds } } });
        });
    }
    
    updateQuery(id, start, end, name, thesis, type) {
      return this.Query.update({
        start: start,
        end: end,
        name: name,
        thesis: thesis,
        type: type
      }, {
        where: {
          id: id
        }
      });
    }
    
    deleteQuery(id) {
      return this.setQueryEditorUserMap(id, {})
        .then(() => {
          return this.Query.destroy({ where: { id : id } });
        });
    }
    
    // QueryEditors
    
    findQueryEditorByQueryIdUserId(queryId, userId) {
      return this.QueryEditor.findOne({ where: { queryId : queryId, userId: userId } });
    }
    
    setQueryEditorUserMap(queryId, editorUserMap) {
      const createPromises = _.map(editorUserMap, (role, userId) => {
        return this.QueryEditor.create({
          queryId: queryId,
          userId: userId,
          role: role
        });
      });
      
      return this.QueryEditor.destroy({ where: { queryId : queryId } })
        .then(() => {
          return this.sequelize.sync()
            .then(() => {
              return Promise.all(createPromises);          
            });
        });
    }

    // QueryUsers
    
    createQueryUser(queryId, userId) {
      return this.QueryUser.findOrCreate({ where: { queryId: queryId, userId: userId } })
        .then((queryUser) => {
          return queryUser[0];
        });
    }
    
    findQueryUserByQueryIdAndUserId(queryId, userId) {
      return this.QueryUser.findOne({ where: { queryId: queryId, userId: userId } });
    }
    
    findQueryUsersByQueryId(queryId, userId) {
      return this.QueryUser.findAll({ where: { queryId: queryId } });
    }
    
    findQueryUserBySession(id) {
      return this.Session.findOne({ where: { id : id } })
        .then((session) => {
          if (!session) {
            this.logger.warn("Session not defined");
            return null;
          } if (!session.queryUserId) {
            this.logger.warn("Session queryId not defined");
            return null;
          } else {
            return this.QueryUser.findOne({ where: { id : session.queryUserId } });
          }
        });
    }
    
    listQueryUsersByQueryId(queryId) {
      return this.QueryUser.findAll({ where: { queryId: queryId } });
    }
    
    listPeerQueryUsersBySessionId(sessionId) {
      return this.findQueryUserBySession(sessionId)
        .then((queryUser) => {
          if (!queryUser) {
            this.logger.warn("Could not find query user");
            return [];
          } else {
            return this.listQueryUsersByQueryId(queryUser.queryId);
          }
        });
    }
    
    findQueryUser(id) {
      return this.QueryUser.findOne({ where: { id : id } });
    }
    
    // Answers
    
    createAnswer(queryUserId, x, y) {
      return this.sequelize.sync().then(() => this.Answer.create({
        queryUserId: queryUserId,
        x: x,
        y: y
      }));
    }
    
    findFirstAndLastAnswersByQueryUserId(queryUserId) {
      return new Promise((resolve, reject) => {
        this.findLatestAnswerByQueryUserId(queryUserId)
          .then((latest) => {
            this.findFirstAnswerByQueryUserId(queryUserId)
              .then((first) => {
                if (first && latest) {
                  resolve({
                    "first": first.dataValues.createdAt,
                    "latest": latest.dataValues.createdAt
                  });
                }
              });
          });
      });
    }
    
    findFirstAnswerAndLastCommentByQueryUserId(queryUserId, queryId) {
      return this.findLatestCommentByQueryUserId(queryUserId, queryId)
        .then((latest) => {
          return this.findFirstAnswerByQueryUserId(queryUserId)
            .then((first) => {
              if (first && latest) {
                return {
                  "first": first.dataValues.createdAt,
                  "latest": latest.dataValues.createdAt
                };
              }
            });
        });
    }
    
    findCommentsByTimeAndQueryUserId(firstTime, secondTime, queryUserId) {
      return this.Comment.findAll({ where: { queryUserId: queryUserId, createdAt: { $between: [firstTime, secondTime] } }, order: [ [ 'createdAt', 'ASC' ] ]});
    }
    
    findAnswersByTimeAndQueryUserId(firstTime, secondTime, queryUserId) {
      return this.Answer.findAll({ where: { queryUserId: queryUserId, createdAt: { $between: [firstTime, secondTime] } }, order: [ [ 'createdAt', 'ASC' ] ]});
    }
    
    findLatestAnswerByQueryUserId(queryUserId) {
      return this.Answer.findOne({ where: { queryUserId: queryUserId }, order: [ [ 'createdAt', 'DESC' ] ]});
    }
    
    findLatestCommentByQueryUserId(queryUserId, queryId) {
      return this.Comment.findOne({ where: { queryUserId: queryUserId, queryId: queryId }, order: [ [ 'createdAt', 'DESC' ] ]});
    }
    
    findLatestAnswerByQueryUserAndCreated(queryUserId, createdAt) {
      return this.Answer.findOne({ where: { queryUserId: queryUserId, createdAt : { $lte: createdAt } }, order: [ [ 'createdAt', 'DESC' ] ]});
    }
    
    // Comments
    
    createComment(isRootComment, parentCommentId, queryUserId, queryId, comment, x, y) {
      return this.sequelize.sync().then(() => this.Comment.create({
        isRootComment: isRootComment,
        parentCommentId: parentCommentId,
        queryUserId: queryUserId,
        queryId: queryId,
        comment:  comment,
        x: x,
        y: y
      }));
    }
    
    listCommentsNewerThanGivenTimeByQueryId(queryId, time) {
     return this.Comment.findAll({ where: { queryId: queryId, createdAt: { $gte: time } } }); 
    }
    
    findFirstAnswerByQueryUserId(queryUserId) {
      return this.Answer.findOne({ where: { queryUserId: queryUserId }, order: [ [ 'createdAt', 'ASC' ] ]});
    }
    
    findComment(id) {
      return this.Comment.findOne({ where: { id : id } });
    }
    
    listCommentsByParentCommentId(parentCommentId) {
      return this.Comment.findAll({ where: { parentCommentId: parentCommentId }, order: [ [ 'createdAt', 'DESC' ] ]});
    }
    
    listRootCommentsByQueryId(queryId) {
      return this.Comment.findAll({ where: { queryId: queryId, isRootComment: true }, order: [ [ 'createdAt', 'DESC' ] ]});
    }
    
  } 
  
  module.exports = (options, imports, register) => {
    const shadySequelize = imports['shady-sequelize'];
    const logger = imports['logger'];
    const models = new Models(logger, shadySequelize);
    
    register(null, {
      'live-delphi-models': models
    });
  };
  
})();