/*  TODO:
 *
 *  - Find a way to add namespaces to state, so fromAmbidex.getters.routerState resolves to ["fromAmbidex", "routerState"]
 *
 *  - createGetters:
 *    - convert [getter, "prop", "subprop"] to ["path", "to", "getter", "prop", "subprop"]
 *    - warn if path doesn't start with a module's own store name or a getter
 *    - might need to make these first so stores with includeOnRequests can find the getters
 *
 *  - Helpers to create common stores:
 *    - on(action, (lastValue, { newValue }) => newValue)
 *    - on(action, (lastValue, { newValue }) => lastValue.set(newValue.get(key), newValue))
 *
 *  - Come up with a name for the isomophic sugar (e.g. not experimental-nuclear-js)
 */


var Immutable = require("immutable");
var nuclear   = require("nuclear-js/src/main");
nuclear.utils = require("nuclear-js/src/utils");
var asap      = require("asap")
var cookie    = require("cookie");

var {
  Reactor,
  Store,
} = nuclear;

// Need to validate getters ourselves because of
// https://github.com/optimizely/nuclear-js/issues/59
var {
  isArray,
  isString,
  isFunction,
} = nuclear.utils;

var isGetter = function (value) {
  return isArray(value) && value.every(
    (item, i) =>    isString(item)
                 || (i === value.length - 1 && isFunction(item))
                 || isGetter(item)
  );
};

Reactor.prototype.createActions = function (actionNames) {
  return Immutable.fromJS(actionNames || []).toMap().mapEntries(
    ([key, value]) => {
      var action, actionName;

      if (key.constructor === Number && value.constructor === String) {
        actionName  = value;
        action      = (payload) =>  this.dispatch(
                                      action,
                                      payload
                                    );

      } else if (key.constructor === String && value.constructor === Function) {
        actionName  = key;
        action      = (payload) =>  this.dispatch(
                                      action,
                                      value(payload)
                                    );
      } else {
        throw new Error(`createActions accepts either a list of action names or a map of action names to complex action functions.  It doesn't know how to handle ${ key }: ${ value }.`);
      }

      return [actionName, action];
    }
  ).toObject();
};

//  createStores combines Nuclear's `new Store` and `registerStores`
Reactor.prototype.createStores = function (storeDefinitions) {
  var stores = Immutable.Map(storeDefinitions).map(
    definition => new Store(definition)
  );

  this.registerStores(stores.toObject());

  this.storesToSerializeForRequests = stores.filter(
    store => store.includeOnRequests
  ).map(
    (store, storeName) => {
      store.__handlers = store.__handlers.map(
        listener => (...listenerArgs) => {
                      // The Nuclear Store will update its state using the listener's return
                      // value.  Update the cookie as soon as possible after that happens, so we
                      // are ready to send it the next time the user navigates away.
                      asap(() => this.serializeForRequests());

                      return listener.apply(store, listenerArgs);
                    }
      );

      return store;
    }
  ).merge(
    this.storesToSerializeForRequests
  );

  return stores.toObject();
};

Reactor.prototype.serializeForRequests = function () {
  if (!global.document)
    return;

  var serializedState = this.serialize(this.storesToSerializeForRequests, true);

  document.cookie = cookie.serialize(
    "nuclearState",

    JSON.stringify(serializedState),

    {
      // apply to all paths by default; this should probably be configurable
      "path":   "/"
    }
  );
};

Reactor.prototype.serialize = function (stores, filterStateForRequest) {
  return (stores || this.__stores).map(
    (store, storeName) => [store, this.__state.get(storeName), storeName]
  ).map(
    ([store, state, storeName]) => {
      if (filterStateForRequest) {
        if (isGetter(store.includeOnRequests) && state.get) {
          var keys = this.evaluate(store.includeOnRequests);

          if (!Immutable.Iterable.isIterable(keys))
            keys = Immutable.List([keys]);


          state = keys.toMap().mapEntries(
            ([i, key]) => [key, state.get(key)]
          );

        } else if (store.includeOnRequests !== Boolean(store.includeOnRequests)) {
          console.warn(`If store.includeOnRequests is not a Boolean, the store should be a Map and the getter should evaluate to a List of keys to filter the Map with.  Until you fix this, we'll treat ${ storeName }.includeOnRequests as true.`);
        }
      }

      return store.serialize
        ? store.serialize(state)
        : nuclear.toJS(state);
    }
  ).toObject();
};

Reactor.prototype.deserialize = function (serializedStates) {
  serializedStates = Immutable.Map(serializedStates);

  this.__state = this.__stores.map(
    (store, storeName) => [
                            store,
                            serializedStates.has(storeName)
                              ? serializedStates.get(storeName)
                              : store.getInitialState()
                          ]
  ).map(
    ([store, serializedState]) => store.deserialize
                                    ? store.deserialize(serializedState)
                                    : nuclear.toImmutable(serializedState)
  );

  if (this.storesToSerializeForRequests.size)
    this.serializeForRequests();
};

var originalReset = Reactor.prototype.reset;

Reactor.prototype.reset = function () {
  originalReset.apply(this, arguments);

  if (this.storesToSerializeForRequests.size)
    this.serializeForRequests();
};

var ReactorConstructor = function (definitions) {
  var REACTOR_FLAGS = ["debug"];

  var {
    reactorConfig,
    definitions
  } = Immutable.Map(definitions).groupBy(
    (value, key) => REACTOR_FLAGS.includes(key)
                      ? "reactorConfig"
                      : "definitions"
  ).toObject();

  reactorConfig = reactorConfig
    ? reactorConfig.toObject()
    : {}

  var result = new Reactor(reactorConfig);

  /*  Nuclear currently presumes that the module namespace is flat.
   *  Therefore, we do too.                                                   */

  Immutable.Seq(definitions).forEach(
    (definition, name) => {
      // Using a forEach instead of an assign(map()) to make collision testing
      // more robust
      console.assert(
        !result.hasOwnProperty(name),
        `A ${ name } property already exists on this reactor.  Please choose a different name.`
      );

      var actionsAndGetters = {
        "actions":  Immutable.Map(
                      result.createActions(definition.simpleActions)
                    ),
        "getters":  definition.getters,

        "reactor":  result,
      };

      // bind complexActions to actionsAndGetters and add them to actions
      actionsAndGetters["actions"] = actionsAndGetters["actions"].merge(
        result.createActions(
          Immutable.Map(definition.complexActions).map(
            fn => fn.bind(actionsAndGetters)
          )
        )
      ).toObject();

      result.createStores(
        Immutable.Map(definition.stores).map(
          storeDefinition =>  (
                                {
                                  ...storeDefinition,
                                  ...actionsAndGetters,
                                }
                              )
        )
      );

      result[name] = actionsAndGetters;
    }
  );

  return result;
};

module.exports = Object.assign(
  {},

  nuclear,

  {
    "Reactor":      ReactorConstructor,
  }
);
