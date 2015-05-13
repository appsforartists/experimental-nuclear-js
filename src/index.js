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
var asap      = require("asap")
var cookie    = require("cookie");

var {
  Reactor,
  Store,
} = nuclear;

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

  var serializedState = this.serialize(this.storesToSerializeForRequests);

  document.cookie = cookie.serialize(
    "nuclearState",

    JSON.stringify(serializedState),

    {
      // apply to all paths by default; this should probably be configurable
      "path":   "/"
    }
  );
};

Reactor.prototype.serialize = function (stores) {
  return (stores || this.__stores).map(
    (store, storeName) => [store, this.__state.get(storeName)]
  ).map(
    ([store, state]) => store.serialize
                          ? store.serialize(state)
                          : nuclear.toJS(state)
  );
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
