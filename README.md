# sequelize-transactional-method
A helper utility for building methods which should interact with Sequelize and must support executing both in a standalone transaction or bundled together with a supplied one.

## Example usage:

One might define a basic `UserService` and its `create` method like so:
```js

const Joi = require('joi');
const bcrypt = require('bcrypt');
const transactional = require('sequelize-transactional-method');

module.exports = {

  /**
   * Define all our data schemas for different operations.
   */
  schema: {
    create: Joi.object().keys({
      name: Joi.string().max(995).required(),
      email: Joi.string().email().required(),
      username: Joi.string().min(3).max(16).required(),
      password: Joi.string().min(8).max(72).required(),
    }),
  },

  /**
   * Creates a new user record populated with the given data.
   *
   * @param {sequelize.Sequelize} db - The database instance which should be used to create
   * the new record.
   *
   * @param {Object} data - An object containing the data which should be used to populate
   * the new object.
   * @param {string} data.name - Readable name of the user.
   * @param {string} data.email - Email of the new user.
   * @param {string} data.username - Username for the new user.
   * @param {string} data.password - Password to set for the user, will be hashed.
   *
   * @param {sequelize.Transaction} [transaction] - An optional transaction which the record
   * creation process should be bundled with. If not given, a local transaction will be made
   * instead.
   */
  create: transactional(async (db, transaction, data) => {
    // Try and validate our data...
    data = await Joi.validate(data, module.exports.schema.create);

    // Hash our password...
    const passwordHashed = await bcrypt.hash(data.password, 10);

    // Try and create our desired user record...
    await db.models.user.create({
      name: data.name,
      email: data.email,
      username: data.username,
      password: passwordHashed,
    }, { transaction });
    
    // Handle some other records needed for the user here... If anything fails, the whole
    // transaction will be rolled-back, unless it was originally provided by the `#create`
    // caller.
    //
    // On the other hand, if all succeeds, then any automatically generated transaction will
    // be commit.
  }),

};
```

The `create` method may then be used like:

```js
const db = new Sequelize(...);

await UserService.create(db, {
  name: 'Potato Man',
  email: 'me@potato.com',
  username: 'potato',
  password: 'p0t@t0',
});
```

In this case, you can see we provide no transaction, but one is automatically made instead by the helper. By default, only
these automatically generated transactions will be rolled-back on error or commit on success.

If you'd like to batch creating multiple users into one single provided transaction, it'd go something like:

```js
const db = new Sequelize(...);
const tx = await db.transaction();

await UserService.create(db, {
  name: 'Potato Man',
  ...
}, tx);

await UserService.create(db, { ... }, tx);
await UserService.create(db, { ... }, tx);
await UserService.create(db, { ... }, tx);

await tx.commit();
```

Please note that in this case, it will be up to the caller to rollback the transaction on error and
to perform the commit operation when desired.

## Example usage, error handling:

By using the error handler it's possible to extend the default error behaviour of just rolling-back
any automatically made transaction. In fact, one could even side-step the error altogether and return
a plain old value, making it appear as if an error never occurred from the caller's perspective.

Basing things upon the `UserService` above and assuming all other things stay the same, we could re-implement
the default rollback logic like so:

```js

module.exports = {
    
    create: transactional(async (db, transaction, data) => {
      // ” handler code above
    }, async (err, db, transaction, originalTransaction) => {
      // From this error handler here we have access to (of course) the error, along with the
      // database instance, the transaction used, and any original transaction which was passed
      // in (if one was passed at all).
      
      // To re-implement the default behaviour, we could do something like rollback only when
      // lacking an originalTransaction and not finished:
      if (!originalTransaction && !transaction.finished) {
        await transaction.rollback();
      }
    }),

}

```

In the example above, we don't do anything super interesting, but it goes to show how you can
differentiate between cases where a transaction has been provided by the caller and when one
has been generated automatically.

Some more interesting use-cases might include performing a retrieval or altered query in case
of some conflict and returning the result of that instead, or transforming the error to a more
friendly value, etc.
