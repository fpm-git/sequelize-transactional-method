
/**
 * Helper method for data prettification.
 */
const pretty = v => require('util').inspect(v, false, 2, false);

/**
 * Helper method to check if an object is roughly a Sequelize instance. Unfortunately, we
 * can't check by actual instanceof, as the import may differ between this module and the
 * consumer.
 */
const isSequelize = v => (v instanceof Object) && (v.constructor.name === 'Sequelize');

/**
 * Helper method to check if an object is a Transaction instance. As mentioned above, due
 * to flexible imports, we can't check using actual instanceof, so the approximation must
 * suffice.
 */
const isTransaction = v => (v instanceof Object) && (v.constructor.name === 'Transaction');

/**
 * Generates an async function intended to handle some operation which may be added to
 * an existing Sequelize transaction or which should generate a new transaction in the
 * case where no transaction was given.
 *
 * This allows for chaining any number of service methods into a single transaction or
 * executing each separately depending on your needs.
 *
 * By default, if an error is thrown, any locally generated transaction will be rolled
 * back. If a transaction was supplied instead, then it is the caller's responsibility
 * to perform any rollback. Of course, this may be configured using the method's error
 * handler if the default behaviour is not suitable.
 *
 * @param {(db: sequelize.Sequelize, transaction?: sequelize.Transaction, ...params?: any[]) => Promise<any>} handler
 * A function containing the actual method code. From here, you should work freely with
 * the db and transaction. If this completes without error and a local transaction was
 * created, then it will be committed. If an error is thrown, then the given error-handler
 * will be executed, if any. If no error handler exists, then any local transaction is
 * rolled-back by default.
 *
 * @param {(error: Error, db: sequelize.Sequelize, transaction: sequelize.Transaction, originalTransaction?: sequelize.Transaction) => Promise<any>} errorHandler
 * A function used to handle errors which occur while executing the handler or during the
 * rollback phase. This function should be supplied in cases where additional processing
 * is necessary beyond from the default behaviour.
 *
 * This function is called with the error in question (`error`), the Sequelize database
 * instance being targetted (`db`), the transaction being used (`transaction`), and any
 * given transaction (`originalTransaction`). The `originalTransaction` may be null, in
 * the case where a locally made one is used instead.
 *
 * An error handler should either return a value to cancel out the exception and return
 * normally in stead of the action, or throw an error.
 *
 * If not supplied, any automatically generated transaction is rolled-back. When given,
 * the user-defined error handler is responsible for performing transaction rollback.
 *
 * @returns {(db: sequelize.Sequelize, transaction?: sequelize.Transaction, ...params?: any[]) => Promise<any>)}
 * A function which accepts at least a Sequelize database instance, along with a potential transaction
 * that any necessary update should be appended to, with any additional parameters included afterwards.
 */
function sequelizeTransactionalMethodGenerator(handler, errorHandler) {
  // Ensure our handler is a proper function.
  if (!(handler instanceof Function)) {
    throw new Error(`Expected handler to be a function, but instead received: (${typeof handler}) ${pretty(handler)}`);
  }

  // If we've been given a value for the errorHandler, ensure it is a function.
  if ((typeof errorHandler !== 'undefined') && !(errorHandler instanceof Function)) {
    throw new Error(`Expected the error handler to be a function, but instead received: (${typeof errorHandler}) ${pretty(errorHandler)}`);
  }

  // Return our generated transactional method.
  return async function (...params) {
    // Try and extract our DB and transaction parameters.
    const db = params.find(isSequelize);
    const transaction = params.find(isTransaction);

    // Ensure that we have at least a database instance.
    if (!db || (params[0] !== db)) {
      throw new Error(`Expected the first parameter to be a Sequelize instance, but instead received: (${typeof params[0]}) ${pretty(params[0])}`);
    }

    // Ensure we've a transaction by generating one where we haven't been given one.
    const handlerTransaction = transaction || await db.transaction();

    // Let's filter out the parameters which should be passed to our handler: exclude the
    // DB instance and any given transaction.
    const handlerParams = params.filter(p => (p !== db) && (p !== handlerTransaction));

    // Let's call our handler function and try to return any settled promise value (if it
    // even returns one), handling any error and committing if necessary.
    try {
      const handlerRes = await handler(db, handlerTransaction, ...handlerParams);
      // If we've made this transaction and it hasn't been commit, then do so.
      if (!transaction && !handlerTransaction.finished) {
        await handlerTransaction.commit();
      }
      // Return the original handler result.
      return handlerRes;
    } catch (e) {
      // If we've an error handler, then try and have it handle things. This error handler
      // should either return a value to be returned instead, or throw an error if that is
      // the desired result.
      //
      // We will not perform rollback when an error handler exists, so this responsibility
      // falls on the user-defined handler.
      if (errorHandler) {
        return await errorHandler(e, db, handlerTransaction, transaction);
      } else if (!transaction) {
        // Otherwise, we've no error handler and no given transaction (only the local-made one), so rollback.
        await handlerTransaction.rollback();
      }
      throw e;
    }
  };
};

module.exports = sequelizeTransactionalMethodGenerator;