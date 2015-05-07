This repo contains experimental APIs for building isomorphic applications with [Nuclear.js](https://github.com/optimizely/nuclear-js/).  Current methods include:

- serialize and deserialize: call each store's (de)serialize method, falling back to toJS/toImmutable when no custom method is implemented

- createActions: take a list of action names and returns a map of action names to Reflux-style functors

Also extends the Nuclear constructor to support declarative module definitions:

```javascript
var reactor = new Reactor(
  {
    "moduleA":  {
                  "simpleActions":  [
                                      "doStuff",
                                      "doDifferentStuff",
                                    ],

                  "complexActions": {
                                      "doComplexStuff": function (payload) {
                                                          this.actions.doStuff(payload);

                                                          doSomethingAsync(payload).then(
                                                            this.actions.doDifferentStuff
                                                          );

                                                          return payload;
                                                        },
                                    ],

                  "stores":         {
                                      "stuff":  {
                                                  "serialize":    function (lastValue) {
                                                                    return lastValue.toJSON();
                                                                  },

                                                  "deserialize":  function (serializedValue) {
                                                                    return new Stuff(serializedValue);
                                                                  },

                                                  "initialize":   function () {
                                                                    this.on(
                                                                      this.actions.doStuff,                                                  
                                                                      function (lastValue, newValue) {
                                                                        return lastValue.append(newValue.stuff);
                                                                      }
                                                                    );
                                                                  },
                                                },
                                    },
                
                  "getters"         {
                                      "stuff":  ["stuff"],
                                    },
                },
  }
);

reactor.moduleA.actions.doStuff(
  {
    "stuff":  [
                "banana", 
                "peaches"
              ],
  }
);
```

As this evolves, some methods (like `serialize/deserialize`) will migrate upstream to Nuclear.  The rest will form a new library that builds upon Nuclear with conventions that make isomorphic applications easier to create.
