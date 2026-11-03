---
title: "MongoDB &amp; Mongoose"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/mongodb-mongoose
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# MongoDB &amp; Mongoose

*10 min read · Updated 24 Jul 2026 Topic 43 of 70 Bookmark Mark done Why it matters Almost every Node · Topic 43 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/mongodb-mongoose](https://www.geekyfrontend.in/learn/nodejs-backend-kit/mongodb-mongoose)

---

## Say it in 30 seconds

MongoDB stores BSON documents, a binary form of JSON, in collections, and Mongoose is the library on the official Node driver that checks a schema, casts types, and builds queries before they are sent. You declare a schema, compile it into a model, and that model reads and writes one collection. It exists so a flexible database still has rules in your Node app. The trade-off is that some write methods skip those rules unless you ask for them.

## Why it matters

Almost every Node service has to remember users, orders, or posts between requests. For a large part of the Node world that store is MongoDB. A document looks like the object you already pass around in JavaScript, so there is little translation between the two.

Mongoose sits between your code and MongoDB. It gives you schemas, casting, validation, hooks, and a query API. The interview question is where MongoDB ends and Mongoose begins. If you cannot model data, run CRUD, and explain why `findByIdAndUpdate` skips your validators, both production and interviews get hard.

## The concept, simply

MongoDB organises data as database, then collection, then document. A collection is loosely like a table. A document is loosely like a row, except it is a BSON object that can nest arrays and objects, and two documents in one collection need not share fields. That flexibility is the feature and the hazard.

Mongoose adds a layer. A **schema** is the shape and the rules. A **model** is a constructor bound to one collection, compiled from the schema. A **document** is one instance, with methods such as `.save()`.

![Stacked layers from application code through the Mongoose model and MongoDB driver down to the mongod server](assets/i40_01_26cef54d.svg)

Mongoose validates and casts. The official driver still speaks to `mongod`.

Mongoose is not the database. Under it, the `mongodb` driver serialises to BSON, manages a connection pool, and sends bytes over the wire. When a validator does not run or a field disappears, the usual reason is that Mongoose handed the operation to the driver and skipped its own pipeline.

## How it works (deep)

`mongoose.connect(uri)` opens a pool of sockets to `mongod`. The default cap is 100. Queries you fire before the connection is ready are buffered, which is why `User.find()` at module load does not crash immediately. They flush once the connection is up.

A schema lists field names, types (`String`, `Number`, `Date`, `ObjectId`, `Buffer`, arrays, nested objects), and rules (`required`, `unique`, `default`, `min`, `enum`, or a custom `validate`). `mongoose.model('User', schema)` compiles a model. The string `'User'` is pluralised and lower-cased into the collection name `users`. People go looking for a collection that was never going to have that name.

`User.find({ age: { $gt: 18 } })` does not run immediately. It returns a **Query**, a thenable builder. It runs when you `await` it, call `.then()`, or call `.exec()`. Before it sends, Mongoose casts filter values to the schema types, so the string `"18"` becomes the number `18`. The raw driver does not do that for you.

On the way back, BSON becomes a full Mongoose document with getters, virtuals, and methods, unless you called `.lean()`. Lean returns plain JavaScript objects and skips that wrapping. It is much cheaper on a read-only endpoint that only sends JSON.

Two kinds of writes cause the most common bug. **Document writes** (`new User(...).save()`, `doc.save()`) run the full pipeline: casting, validators, and `pre('save')` hooks. **Query writes** (`updateOne`, `updateMany`, `findOneAndUpdate`, `findByIdAndUpdate`) go closer to the driver. By default they skip validators and skip `save` middleware. Pass `{ runValidators: true }` to validate. Even then, `save` hooks do not fire. Update hooks do.

## Code examples

Defining a schema, compiling a model, and doing full CRUD:

javascript

```
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name:  { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  age:   { type: Number, min: 0, max: 130 },
  role:  { type: String, enum: ['user', 'admin'], default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema); // collection: "users"

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  // CREATE
  const ada = await User.create({ name: 'Ada', email: 'ada@x.com', age: 36 });

  // READ
  const adults = await User.find({ age: { $gte: 18 } })
    .select('name email')     // projection
    .sort({ name: 1 })
    .limit(20)
    .lean();                  // plain objects, faster

  // UPDATE (query-based: pass runValidators!)
  await User.updateOne(
    { _id: ada._id },
    { $set: { age: 37 } },
    { runValidators: true }
  );

  // DELETE
  await User.findByIdAndDelete(ada._id);
}
```

The document-based path, which is what you want when you need hooks and full validation:

javascript

```
const doc = new User({ name: 'Lin', email: 'LIN@X.COM' });
// schema lowercases email -> "lin@x.com" during validation
doc.age = 29;
await doc.save();        // runs validators + pre('save') hooks

// pre-save hook example: hash a password before writing
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return; // only when changed
  this.password = await hash(this.password);
});
```

The `Query` object is lazy — a frequent gotcha worth seeing directly:

javascript

```
const q = User.find({ role: 'admin' }); // NOT executed yet
q.where('age').gt(21);                  // still building
const admins = await q;                 // executes here (awaited)

// Same query, explicit execution:
User.find({ role: 'admin' }).exec()
  .then(docs => console.log(docs.length))
  .catch(err => console.error(err));
```

Reading a single record and handling "not found" cleanly:

javascript

```
const user = await User.findById(id);
if (!user) {
  // findById returns null (not an error) when nothing matches
  throw new Error('User not found');
}
```

## Common mistakes & gotchas

- **Expecting `updateOne` or `findByIdAndUpdate` to validate.** By default they skip validators and `pre('save')` hooks. Pass `{ runValidators: true }`. Save hooks still do not fire. Use `save()` when you need them.
- **Expecting `findByIdAndUpdate` to return the new document.** By default it returns the document from before the change. Ask for the new one with the option this lesson's Mongoose 9 notes name.
- **Treating a query as data.** `User.findOne(...)` without `await` is a Query. `u.name` is `undefined`.
- **Treating `unique: true` as a validator.** It asks for a unique index. A duplicate throws a driver error, code `11000`, at write time, and only after the index exists.
- **Skipping `.lean()` on a hot read.** Hydrating thousands of documents wastes CPU and memory when you only send JSON.
- **Calling `connect()` on every request.** Especially in serverless, that exhausts connections. Connect once and reuse.
- **Guessing the collection name.** `model('Person')` writes to `people`. Pass a third argument when you need a fixed name.

## Best practices

- Connect once at startup, or cache the connect promise in serverless, and let Mongoose keep the pool.
- Use `.lean()` for read-only JSON. Keep full documents when you will mutate and `save()`.
- When you update by query and want the new document validated, pass the options as a team habit, and remember save hooks still do not run.
- Define indexes in the schema. In production, build them on purpose instead of relying on `autoIndex`.
- Catch duplicate-key code `11000` and answer 409.
- Keep business rules in validators and hooks so a controller cannot forget them.
- Set `select: false` on secrets such as a password hash so they stay out of query results unless you ask.

## ⭐ Interview lens

> **Q: What is the difference between MongoDB and Mongoose?**  
> MongoDB is the database. The official `mongodb` driver is what speaks BSON over the wire and holds the connection pool. Mongoose is an ODM, an object-document mapper, layered on that driver. You declare a schema, compile a model bound to one collection, and get casting, validators, middleware hooks, virtuals, and a query builder. MongoDB itself will store two documents with different fields. Mongoose is what enforces a shape from your Node app. For example, a schema field of type Number casts the string `"18"` to 18 before the query is sent. The limit is that Mongoose is not in the path for every write. Query updates such as `findByIdAndUpdate` skip validators and `save` hooks unless you opt in, because those calls go closer to the driver.

> **Q: Why does my validator not run on `findByIdAndUpdate`?**  
> `findByIdAndUpdate` is a query write. It does not load a document and call `save()`. The full pipeline, casting plus validators plus `pre('save')` hooks, runs on document methods such as `new User().save()` and `doc.save()`. By default a query update skips validators and skips save middleware. Pass `{ runValidators: true }` and the validators run. Save hooks still do not. Only update hooks such as `pre('findOneAndUpdate')` run for that call. For example, a `pre('save')` hook that hashes a password never sees a `findByIdAndUpdate` that sets `password`. The limit is that `runValidators: true` is not a switch for hooks. If the rule has to live in a save hook, load the document and `save()` it.

> **Q: What does `.lean()` do and when would you use it?**  
> `.lean()` tells Mongoose to skip hydration. Hydration means wrapping each BSON result in a document object with getters, virtuals, instance methods, and change tracking. Lean returns plain JavaScript objects. Use it on a read-only endpoint that only sends JSON, especially when a page returns hundreds of rows, because building those wrappers costs CPU and memory you then throw away. For example, `User.find().lean()` gives objects you can pass to `res.json` directly. The limit is that a lean object has no `.save()`, no virtuals, and no getters. If the response needs a virtual, or the next line mutates and saves, keep the full document. The speedup is the wrappers you skipped, not a different query on the server. The same filter and the same index run either way.

> **Q: When is a Mongoose query actually executed?**  
> Building a query does not run it. `User.find({ age: { $gt: 18 } })` returns a Query object, which is a thenable. The driver sends the command when you `await` the query, call `.then()`, or call `.exec()`. That delay is what lets you chain `.where()`, `.sort()`, and `.limit()` and still pay for one round trip. For example, `const q = User.find()` followed by `q.name` is undefined, because `q` is not a user. The limit is easy to miss in a function that returns the query without awaiting it. The caller receives a Query, serializes it badly, and the database work happens later than they think, or not at all if nobody awaits it.

## Cheat-card

- Hierarchy: database, collection, document (BSON).
- Schema is the shape. Model is bound to a collection. Document is one instance.
- `model('User')` uses the collection `users`.
- Queries run on `await`, `.then()`, or `.exec()`.
- `save()` runs validators and save hooks. `updateOne` and `findByIdAndUpdate` skip both unless you opt in.
- `.lean()` for read-only JSON. Duplicate key error code is `11000`.

## Good to know

- Default pool size on `mongoose.connect` is up to 100 sockets.
- `timestamps: true` sets `createdAt` and `updatedAt` on `save()`, and on query updates it adds `$set` of `updatedAt` and `$setOnInsert` of `createdAt`. `{ timestamps: false }` skips that for one query.
- A virtual is not stored. Define it with `schema.virtual()`. A populate virtual uses `{ ref, localField, foreignField, count? }`. `toJSON: { virtuals: true }` and `toObject` are separate. `.lean()` has no virtuals.
- `Base.discriminator('Name', schema)` shares one collection. The key defaults to `__t`. It is written on save and added to every child-model query.
- Map errors once: `CastError` to 400, `ValidationError` to 422 (a cast inside `create()` lands inside it), `err.code === 11000` to 409 whether the class is `MongoServerError` or `MongoBulkWriteError`. `await Model.init()` before you test duplicates.
- `{ "password": { "$ne": null } }` in a JSON body can bypass `findOne({ email, password })`. `sanitizeFilter` wraps objects whose keys start with `$` in `$eq`. Use `mongoose.trusted()` for operators your own code builds.
- On 12 Oct 2026 `npm view mongoose dist-tags` reported `latest: 9.11.1` (released 2026-10-07), `8x: 8.24.5`, and `next: 9.0.0-rc1`. 9.0.0 was released on 2025-11-21.
- Mongoose 9.11.1: `pre` hooks get no `next()` (changed in v9.0). `returnDocument: 'after'` replaces `{ new: true }`, which still works and prints a deprecation warning (deprecated in v9.2.0).
- Q: Is `unique: true` a validator? No. It creates a unique index. A duplicate throws a driver error with code 11000, after the index has finished building. Catch 11000 yourself for a friendly 409.
- Q: How do you avoid connection exhaustion in a serverless function? Cache the connection, or the connect promise, on a global so a warm invocation reuses it. Keep `maxPoolSize` small per instance. Do not call `mongoose.connect()` inside the handler.
- Q: How would someone log in as admin without the password? `User.findOne({ email, password })` with a JSON body of `"password": { "$ne": null }` means "this email and any password." Check that inputs are strings, compare a hash in code, and turn on `sanitizeFilter`, which wraps `$` objects in `$eq`. On a String path that then fails the cast and a mapper can return 400. Wrap your own operators in `mongoose.trusted()`.
- Q: What is the difference between a CastError and a ValidationError? A CastError is a value that cannot be converted to the schema type in a query or an update, such as `findById('abc')`. A ValidationError is a document failing its rules on save or create, with one entry per path. A cast during `create()` sits inside the ValidationError. Duplicates are neither. They are server errors with code 11000. Map all three.

---

## Learn More

- [Getting Started with Mongoose mongoosejs.com](https://mongoosejs.com/docs/index.html)
- [Mongoose Schemas Guide mongoosejs.com](https://mongoosejs.com/docs/guide.html)
- [Mongoose Validation mongoosejs.com](https://mongoosejs.com/docs/validation.html)
- [Mongoose Crash Course - Beginner Through Advanced Web Dev Simplified](https://www.youtube.com/watch?v=DZBGEVgL2eE)
- [MongoDB Tutorial #1 - Introduction to MongoDB Net Ninja](https://www.youtube.com/watch?v=9OPP_1eAENg)


---

## Additional topics

*Added 12 Oct 2026 · examples verified on Node v24.19.0 and Mongoose 9.11.1 (bundles the `mongodb` driver 7.7.0), Express 5.3.0, supertest 7.3.1, MongoDB 8.2.6 run locally via mongodb-memory-server's downloaded mongod binary (no Docker)*

**Which Mongoose.** These examples use Mongoose 9.11.1, the stable 9.x line. The release tags are under Good to know. Two Mongoose 9 changes affect code written for 8.x. `pre` middleware no longer receives `next()`, so use `async function` hooks (changed in v9.0). And `{ new: true }` on `findOneAndUpdate()` still works but prints a deprecation warning; `returnDocument: 'after'` replaces it (changed in v9.2.0). Install with `npm install mongoose@9.11.1 express@5.3.0` and `npm install -D supertest@7.3.1`. Each example below is a standalone ES module run with `MONGO_URL=mongodb://127.0.0.1:<port>/<db> node file.mjs`.

### The `timestamps` schema option
`timestamps: true` makes Mongoose manage two `Date` fields, `createdAt` and `updatedAt`. Without it, every write path has to remember to set them, and query-based updates (`updateOne`, `findOneAndUpdate`), which skip `save` hooks, are where people forget.

How it works:

1. On `save()` of a new document, Mongoose sets both fields to the same `Date`.
2. On `save()` of an existing modified document, it sets `updatedAt`.
3. On query updates (`updateOne`, `updateMany`, `findOneAndUpdate`, `replaceOne`), it adds `$set: { updatedAt }` and `$setOnInsert: { createdAt }` to the update it sends.
4. `{ timestamps: false }` as a query option skips step 3 for that one call.
5. `timestamps: { createdAt: 'created_at', updatedAt: false }` renames a field or turns it off.

**Example — both fields, a query update, an opt-out, and a renamed field.**

javascript

```
// timestamps.mjs — createdAt/updatedAt managed by Mongoose
import mongoose from 'mongoose';
import { setTimeout as sleep } from 'node:timers/promises';

await mongoose.connect(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/l43_timestamps');
await mongoose.connection.dropDatabase();

const Post = mongoose.model('Post', new mongoose.Schema({ title: String }, { timestamps: true }));
const Event = mongoose.model('Event', new mongoose.Schema({ kind: String },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }));     // rename one, disable the other

const p = await Post.create({ title: 'Hello' });
console.log('created:', p.createdAt.toISOString(), '| updated:', p.updatedAt.toISOString());
await sleep(20);
await Post.updateOne({ _id: p._id }, { $set: { title: 'Hello again' } });         // query update: updatedAt bumped too
const after = await Post.findById(p._id).lean();
console.log('after updateOne, updatedAt moved:', after.updatedAt > after.createdAt);
await Post.updateOne({ _id: p._id }, { $set: { title: 'quiet' } }, { timestamps: false }); // opt out per query
console.log('with timestamps:false, updatedAt unchanged:',
  (await Post.findById(p._id).lean()).updatedAt.getTime() === after.updatedAt.getTime());

const e = await Event.create({ kind: 'login' });
console.log('Event keys:', Object.keys(e.toObject()));
await mongoose.disconnect();

// Real output (Node v24.19.0, Mongoose 9.11.1, MongoDB 8.2.6):
//   created: 2026-10-12T14:32:01.326Z | updated: 2026-10-12T14:32:01.326Z
//   after updateOne, updatedAt moved: true
//   with timestamps:false, updatedAt unchanged: true
//   Event keys: [ 'kind', '_id', 'created_at', '__v' ]
```

The ISO times are from one run and change on every run. The three `true`/key lines repeat.

### Virtuals: getters, setters, populate virtuals, and `toJSON`/`toObject`
A virtual is a property defined on the schema that is **not stored** in MongoDB. A getter computes it from stored fields. A setter takes a value and writes stored fields from it. A *populate virtual* is a relationship resolved at query time: the parent stores nothing, and Mongoose runs a second query on the child collection by `foreignField`. Virtuals keep derived values and reverse relationships out of the database, so they cannot drift from the fields they come from.

How it works:

1. `schema.virtual('fullName').get(fn).set(fn)` defines the property on the model's prototype. `this` is the document.
2. `new Author({ fullName: 'Ada King Lovelace' })` calls the setter, which writes `first` and `last`. Only those two fields are saved.
3. `schema.virtual('posts', { ref, localField, foreignField })` declares the reverse relation. `.populate('posts')` runs `Post.find({ authorId: { $in: [ids] } })` and attaches the results. With `count: true`, it attaches a number instead.
4. `toJSON()`, which `res.json()` and `JSON.stringify` use, and `toObject()` leave out virtuals unless the schema sets `toJSON: { virtuals: true }` or `toObject: { virtuals: true }`. The two options are separate, so `console.log(doc.toObject())` can disagree with what the API returns.
5. `.lean()` returns plain objects with no prototype, so virtuals are `undefined`. The separate `mongoose-lean-virtuals` plugin targets that case (not tested here).

**Example — getter, setter, populate virtual with `count`, and the two serialisers.**

javascript

```
// virtuals.mjs — computed properties, a setter that splits input, and a populate virtual
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/l43_virtuals');
await mongoose.connection.dropDatabase();

const authorSchema = new mongoose.Schema({ first: String, last: String }, {
  toJSON: { virtuals: true },          // include virtuals in res.json() / JSON.stringify
  // toObject left at the default: virtuals are NOT included
});
authorSchema.virtual('fullName')
  .get(function () { return `${this.first} ${this.last}`; })
  .set(function (v) { const [first, ...rest] = v.split(' '); this.first = first; this.last = rest.join(' '); });
// Populate virtual: posts are not stored on the author; they are found by posts.authorId at query time
authorSchema.virtual('posts', { ref: 'Post', localField: '_id', foreignField: 'authorId' });
authorSchema.virtual('postCount', { ref: 'Post', localField: '_id', foreignField: 'authorId', count: true });

const Author = mongoose.model('Author', authorSchema);
const Post = mongoose.model('Post', new mongoose.Schema({ title: String, authorId: mongoose.Schema.Types.ObjectId }));

const ada = new Author({ fullName: 'Ada King Lovelace' });     // the setter runs
await ada.save();
await Post.create([{ title: 'Notes on the Engine', authorId: ada._id }, { title: 'Bernoulli numbers', authorId: ada._id }]);

console.log('stored fields:', await Author.collection.findOne({}, { projection: { _id: 0 } }));
const a = await Author.findById(ada._id).populate({ path: 'posts', select: 'title -_id', options: { sort: { title: 1 } } }).populate('postCount');
console.log('getter:', a.fullName, '| postCount:', a.postCount, '| posts:', a.posts.map(p => p.title));
console.log('toJSON keys:  ', Object.keys(a.toJSON()));
console.log('toObject keys:', Object.keys(a.toObject()));
const lean = await Author.findById(ada._id).lean();
console.log('lean fullName:', lean.fullName);
await mongoose.disconnect();

// Real output (Node v24.19.0, Mongoose 9.11.1, MongoDB 8.2.6):
//   stored fields: { first: 'Ada', last: 'King Lovelace', __v: 0 }
//   getter: Ada King Lovelace | postCount: 2 | posts: [ 'Bernoulli numbers', 'Notes on the Engine' ]
//   toJSON keys:   [
//     '_id',       'first',
//     'last',      '__v',
//     'fullName',  'posts',
//     'postCount', 'id'
//   ]
//   toObject keys: [ '_id', 'first', 'last', '__v' ]
//   lean fullName: undefined
```

The stored document has no `fullName`, `posts` or `postCount`. `toJSON` includes all three, plus the default `id` virtual (the string form of `_id`). `toObject` includes none of them, because only `toJSON` was configured.

### Discriminators
A discriminator is Mongoose's built-in form of the *polymorphic pattern* ([lesson 69](69-mongodb-schema-patterns.md)). Several models with different schemas share one collection, and a *discriminator key* field records which model each document belongs to. Without it, you either create one collection per type, and then cannot query "all events" in one query, or one loose schema that cannot validate type-specific fields.

How it works:

1. The base model, `Event`, owns the collection and the shared fields. `discriminatorKey: 'kind'` names the type field (the default is `__t`).
2. `Event.discriminator('Purchase', schema)` returns a new model whose schema is the base merged with `schema`.
3. Saving a `Purchase` writes `kind: 'Purchase'` and runs the Purchase validators.
4. Every query through `Purchase` gets `kind: 'Purchase'` added to its filter. Queries through `Event` return all kinds, and each document is hydrated as its own model.

**Example — two discriminators on `events`, what is stored, and the filter Mongoose adds.**

javascript

```
// discriminators.mjs — several schemas, one collection, a type key Mongoose manages
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/l43_discriminators');
await mongoose.connection.dropDatabase();

const eventSchema = new mongoose.Schema({ at: { type: Date, default: () => new Date('2026-10-12T09:00:00Z') } },
  { discriminatorKey: 'kind' });
const Event = mongoose.model('Event', eventSchema);                          // collection: events
const Click = Event.discriminator('Click', new mongoose.Schema({ url: { type: String, required: true } }));
const Purchase = Event.discriminator('Purchase', new mongoose.Schema({ amount: { type: Number, min: 0, required: true } }));

await Click.create({ url: '/pricing' });
await Purchase.create({ amount: 49 });
await Event.create({});                                                      // a plain base event

console.log('raw collection:', await mongoose.connection.db.collection('events')
  .find({}, { projection: { _id: 0, at: 0, __v: 0 } }).toArray());
console.log('Event.find():   ', (await Event.find().sort({ _id: 1 })).map(d => `${d.constructor.modelName}:${d.kind ?? '-'}`));
console.log('Purchase.find():', await Purchase.find({}, { _id: 0, amount: 1, kind: 1 }).lean());
console.log('filter added:   ', Purchase.find({ amount: { $gt: 10 } }).getFilter());
try { await Purchase.create({ amount: -1 }); } catch (e) { console.log('child validators:', e.name, '-', e.errors.amount.message); }
await mongoose.disconnect();

// Real output (Node v24.19.0, Mongoose 9.11.1, MongoDB 8.2.6):
//   raw collection: [
//     { kind: 'Click', url: '/pricing' },
//     { kind: 'Purchase', amount: 49 },
//     {}
//   ]
//   Event.find():    [ 'Click:Click', 'Purchase:Purchase', 'Event:-' ]
//   Purchase.find(): [ { kind: 'Purchase', amount: 49 } ]
//   filter added:    { kind: 'Purchase', amount: { '$gt': 10 } }
//   child validators: ValidationError - Path `amount` (-1) is less than minimum allowed value (0).
```

The base event has no `kind` field at all. `Event.find()` still returns it, hydrated as `Event`. If you need "type-specific uniqueness", such as `url` unique among clicks only, use a partial index filtered on `kind` ([lesson 70](70-mongodb-indexes-in-depth.md)).

### Mapping `CastError`, `ValidationError` and duplicate key 11000 in one Express 5 middleware
Mongoose and the driver report bad input as three different errors. A value that cannot be cast in a *query* or *update* is a `mongoose.Error.CastError` (`findById('abc')`). A document that fails its schema rules on `save()`/`create()` is a `mongoose.Error.ValidationError`, with one entry per path in `err.errors`. A unique index violation comes from the server as an error with `code === 11000` and the conflicting `keyValue`. Unmapped, all three become 500s, and clients cannot tell "your id is malformed" from "the database is down".

How it works:

1. Route handlers are `async` and do not catch. Express 5 forwards a rejected promise to the error middleware (Express 4 does not; see [lesson 50](50-error-handling-the-4-arg-handler-and-async-errors.md)).
2. `.orFail()` turns "no document" into a `DocumentNotFoundError`, so the 404 also goes through the error path.
3. The mapper is a four-argument middleware registered after the routes. It checks `instanceof` for the two Mongoose classes and `err.code === 11000` for the duplicate. It answers with the lesson-42/95 error shape `{ error: { code, message, details } }`.
4. Anything else is passed on with `next(err)` to the last-resort handler, which returns a generic 500 (or the 404).

**Example — the mapper and real responses through supertest.**

javascript

```
// errors.mjs — one Express 5 middleware that maps Mongoose/driver errors to HTTP responses
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

await mongoose.connect(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/l43_errors');
await mongoose.connection.dropDatabase();
const User = mongoose.model('User', new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  age: { type: Number, min: 0 },
}));
await User.init();   // wait until the unique index exists, or the duplicate test can race the build

function mongooseErrorMapper(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof mongoose.Error.CastError) {                     // e.g. findById('abc')
    return res.status(400).json({ error: { code: 'INVALID_ID', message: `Invalid ${err.path}`, details: { value: err.value } } });
  }
  if (err instanceof mongoose.Error.ValidationError) {               // schema validators, incl. casts inside a document
    const details = Object.fromEntries(Object.entries(err.errors).map(([path, e]) => [path, { kind: e.kind, message: e.message }]));
    return res.status(422).json({ error: { code: 'VALIDATION_FAILED', message: 'Validation failed', details } });
  }
  if (err?.code === 11000) {                                         // MongoServerError from a unique index
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'Already exists', details: err.keyValue } });
  }
  return next(err);
}

const app = express();
app.use(express.json());
app.get('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id).orFail();          // Express 5 forwards the rejection
  res.json(user);
});
app.post('/users', async (req, res) => {
  res.status(201).json(await User.create(req.body ?? {}));
});
app.use(mongooseErrorMapper);
app.use((err, req, res, next) => {                                    // last resort
  const status = err instanceof mongoose.Error.DocumentNotFoundError ? 404 : 500;
  res.status(status).json({ error: { code: status === 404 ? 'NOT_FOUND' : 'INTERNAL', message: status === 404 ? 'Not found' : 'Internal error' } });
});

const show = (label, r) => console.log(label.padEnd(26), r.status, JSON.stringify(r.body));
const ok = await request(app).post('/users').send({ email: 'Ada@Example.com', age: 36 });
console.log('POST valid'.padEnd(26), ok.status, ok.body.email);
show('POST duplicate email', await request(app).post('/users').send({ email: 'ada@example.com' }));
show('POST missing + negative', await request(app).post('/users').send({ age: -1 }));
show('POST age not a number', await request(app).post('/users').send({ email: 'lin@example.com', age: 'old' }));
show('GET bad id', await request(app).get('/users/abc'));
show('GET unknown id', await request(app).get(`/users/${new mongoose.Types.ObjectId()}`));
await mongoose.disconnect();

// Real output (Node v24.19.0, Mongoose 9.11.1, Express 5.3.0, supertest 7.3.1, MongoDB 8.2.6):
//   POST valid                 201 ada@example.com
//   POST duplicate email       409 {"error":{"code":"DUPLICATE","message":"Already exists","details":{"email":"ada@example.com"}}}
//   POST missing + negative    422 {"error":{"code":"VALIDATION_FAILED","message":"Validation failed","details":{"email":{"kind":"required","message":"Path `email` is required."},"age":{"kind":"min","message":"Path `age` (-1) is less than minimum allowed value (0)."}}}}
//   POST age not a number      422 {"error":{"code":"VALIDATION_FAILED","message":"Validation failed","details":{"age":{"kind":"Number","message":"Cast to Number failed for value \"old\" (type string) at path \"age\" for model \"User\""}}}}
//   GET bad id                 400 {"error":{"code":"INVALID_ID","message":"Invalid _id","details":{"value":"abc"}}}
//   GET unknown id             404 {"error":{"code":"NOT_FOUND","message":"Not found"}}
```

`User.init()` waits until the unique index on `email` exists. Without it, the duplicate request can arrive before the index build finishes, and the second insert succeeds. Note the fourth line: `age: 'old'` on `create()` is reported as a `ValidationError` whose entry has `kind: 'Number'`, not as a top-level `CastError` (see the edge case below).

### `sanitizeFilter` and NoSQL injection
**Query selector injection** happens when a request value that should be a string arrives as an object, such as `{ "$ne": null }` in a JSON body, and the code places it straight into a filter. `findOne({ email, password })` then means "this email, password not null", which matches any account with that email. `mongoose.set('sanitizeFilter', true)` (global), or the query option `sanitizeFilter: true`, wraps every nested object whose key starts with `$` in `$eq`. The value is then compared literally instead of being run as an operator. `mongoose.trusted(obj)` marks an operator object that your own code built, so it is left alone.

How it works:

1. `express.json()` parses `{"password":{"$ne":null}}` into a real object. In Express 5 the default `"simple"` query parser does *not* build objects from `?password[$ne]=`, but JSON bodies always can ([lesson 48](48-routing-params-query-and-routers.md)).
2. Without sanitising, Mongoose casts `{ $ne: null }` as a valid operator for a `String` path and sends it to the server, which returns the admin.
3. With `sanitizeFilter`, the filter becomes `{ password: { $eq: { $ne: null } } }`. On a `String` path Mongoose then cannot cast an object to a string, so the query throws a `CastError`, which the mapper turns into a 400. On a `Mixed` path it would simply match nothing.
4. With the global setting on, an operator that your code writes itself, such as `{ $in: [...] }`, also throws, until you wrap it in `mongoose.trusted()`.

**Example — the bypass, then the same request blocked.**

javascript

```
// sanitize.mjs — a { "$ne": null } login bypass, then the same request with sanitizeFilter
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

await mongoose.connect(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/l43_sanitize');
await mongoose.connection.dropDatabase();
// Plain-text password only to keep the demo short; store hashes in real code (lesson 85)
const User = mongoose.model('User', new mongoose.Schema({ email: String, password: String, role: String }));
await User.create([{ email: 'admin@example.com', password: 'S3cret!', role: 'admin' },
                   { email: 'lin@example.com', password: 'hunter2', role: 'user' }]);

function buildApp({ sanitize }) {
  const app = express();
  app.use(express.json());
  app.post('/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    let q = User.findOne({ email, password });          // VULNERABLE: values go into the filter as-is
    if (sanitize) q = q.setOptions({ sanitizeFilter: true });
    const user = await q;
    if (!user) return res.status(401).json({ error: { code: 'BAD_CREDENTIALS' } });
    res.json({ loggedInAs: user.email, role: user.role });
  });
  app.use((err, req, res, next) => {                     // the CastError branch of the error mapper
    if (err instanceof mongoose.Error.CastError) return res.status(400).json({ error: { code: 'BAD_INPUT', path: err.path } });
    next(err);
  });
  return app;
}
const attack = { email: 'admin@example.com', password: { $ne: null } };
const show = (label, r) => console.log(label.padEnd(30), r.status, JSON.stringify(r.body));
show('no sanitize, real password', await request(buildApp({ sanitize: false })).post('/login').send({ email: 'lin@example.com', password: 'hunter2' }));
show('no sanitize, $ne attack', await request(buildApp({ sanitize: false })).post('/login').send(attack));
show('sanitizeFilter, $ne attack', await request(buildApp({ sanitize: true })).post('/login').send(attack));
show('sanitizeFilter, real password', await request(buildApp({ sanitize: true })).post('/login').send({ email: 'lin@example.com', password: 'hunter2' }));

// What sanitizeFilter does to the filter, and how trusted() opts a known-safe operator back in
console.log(mongoose.sanitizeFilter({ email: 'a@b.c', password: { $ne: null } }));
mongoose.set('sanitizeFilter', true);                    // global: every query from now on
console.log('trusted $in matched:', await User.countDocuments({ role: mongoose.trusted({ $in: ['admin', 'user'] }) }));
try { await User.countDocuments({ role: { $in: ['admin', 'user'] } }); }
catch (e) { console.log('untrusted $in:', e.name, '-', e.message); }
await mongoose.disconnect();

// Real output (Node v24.19.0, Mongoose 9.11.1, Express 5.3.0, supertest 7.3.1, MongoDB 8.2.6):
//   no sanitize, real password     200 {"loggedInAs":"lin@example.com","role":"user"}
//   no sanitize, $ne attack        200 {"loggedInAs":"admin@example.com","role":"admin"}
//   sanitizeFilter, $ne attack     400 {"error":{"code":"BAD_INPUT","path":"password"}}
//   sanitizeFilter, real password  200 {"loggedInAs":"lin@example.com","role":"user"}
//   { email: 'a@b.c', password: { '$eq': { '$ne': null } } }
//   trusted $in matched: 2
//   untrusted $in: CastError - Cast to string failed for value "{ '$in': [ 'admin', 'user' ] }" (type Object) at path "role" for model "User"
```

The second line is the bypass: the attacker knew only the admin's email and got `role: admin`. `sanitizeFilter` is a backstop, not validation. Also validate that `email` and `password` are strings ([lesson 65](65-validation-pagination-filtering-sorting.md)), and compare a password hash outside the query ([lesson 85](85-password-hashing.md)), so the password never goes into a filter at all.

### Common mistakes & gotchas (additional topics)
- **Expecting virtuals in `console.log(doc.toObject())` or in `.lean()` results.** `toObject` and `toJSON` are configured separately, and lean objects have no virtuals.
- **Populating a virtual without `ref`/`localField`/`foreignField`, or with `localField` and `foreignField` swapped.** You get an empty array, not an error.
- **Calling `next()` in a `pre` hook on Mongoose 9.** The parameter is gone (changed in v9.0). Write `async function () {}` and throw to abort.
- **Using `{ new: true }` on Mongoose ≥ 9.2.** It still works but logs a deprecation warning. Use `returnDocument: 'after'`.
- **Checking `err.name === 'MongoServerError'` for duplicates.** `insertMany` reports duplicates as `MongoBulkWriteError`. Check `err.code === 11000`.
- **Echoing `keyValue` for every unique index.** It contains the conflicting value from the request. That is fine for an email the user just typed, but think before you echo, for example, an external account id.
- **Mapping every `CastError` to "invalid id".** Casts on any path raise it. Use `err.path` in the message.
- **Turning on global `sanitizeFilter` without auditing your own operators.** Every `{ $in }` or `{ $gte }` that you build from code throws a `CastError` until it is wrapped in `mongoose.trusted()`.
- **Relying on `sanitizeFilter` alone.** The Mongoose docs describe it as sanitising *query filters*. Aggregation pipelines and update documents built from request input are not filters. Validate types at the edge.

### Edge case worked through: one bad value, three error classes
The same mistake, a non-number `age` or a duplicate email, reaches the error mapper as a different class depending on which API carried it. A mapper that only checks one class sends the others to the 500 branch.

javascript

```
// edge.mjs — the same bad input reaches the error mapper as three different error classes
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/l43_edge');
await mongoose.connection.dropDatabase();
const User = mongoose.model('User', new mongoose.Schema({ email: { type: String, unique: true }, age: Number }));
await User.init();
await User.create({ email: 'ada@example.com', age: 36 });

const describe = (e) => `${e.constructor.name} | name=${e.name} | code=${e.code ?? '-'} | instanceof CastError=${e instanceof mongoose.Error.CastError}`;
const attempts = {
  'find  { age: "old" }':        () => User.find({ age: 'old' }),                    // query cast
  'create { age: "old" }':       () => User.create({ email: 'x@example.com', age: 'old' }), // document cast
  'updateOne $set age "old"':    () => User.updateOne({}, { $set: { age: 'old' } }),  // update cast
  'insertMany duplicate':        () => User.insertMany([{ email: 'lin@example.com' }, { email: 'ada@example.com' }]),
  'updateOne to duplicate':      () => User.updateOne({ email: 'lin@example.com' }, { $set: { email: 'ada@example.com' } }),
};
for (const [label, run] of Object.entries(attempts)) {
  try { await run(); console.log(label.padEnd(26), 'ok'); }
  catch (e) { console.log(label.padEnd(26), describe(e)); }
}
await mongoose.disconnect();

// Real output (Node v24.19.0, Mongoose 9.11.1, MongoDB 8.2.6):
//   find  { age: "old" }       CastError | name=CastError | code=- | instanceof CastError=true
//   create { age: "old" }      ValidationError | name=ValidationError | code=- | instanceof CastError=false
//   updateOne $set age "old"   CastError | name=CastError | code=- | instanceof CastError=true
//   insertMany duplicate       MongoBulkWriteError | name=MongoBulkWriteError | code=11000 | instanceof CastError=false
//   updateOne to duplicate     MongoServerError | name=MongoServerError | code=11000 | instanceof CastError=false
```

How each case arrives:

- **A query filter (`find`) or an update (`updateOne $set`)** fails with a top-level `CastError`.
- **A document (`create`)** wraps the cast failure in a `ValidationError`. The cast error sits inside it at `err.errors.age`.
- **`insertMany`** reports a duplicate as `MongoBulkWriteError` with `code: 11000`. With the default ordered insert, `lin@example.com` was written before the duplicate stopped the batch, which is why the next update then collides with `ada@example.com`.
- **`updateOne` that changes `email`** reports a duplicate as `MongoServerError` with `code: 11000`.

The mapper in the example above therefore checks `instanceof ValidationError`, `instanceof CastError` and `code === 11000`, never the error's `name`.

### ⭐ Interview lens (additional topics)

The questions from this section are under Good to know, one line each.
