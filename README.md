# d4data-filter

A little bit of filtering code to remove (likely) useless info and help learn about the `unk*` segments.

## What It Does

This does some map-reduce-style (in the functional programming sense) work. First we take a pass and filter likely unhelpful data (map). The second pass will re-combine certain files (like the string descriptions) and add comments beginning with `df_$NAME` ('df' for 'data filter') that may either enhance or explain what you're looking at.

Today it only removes unhelpful information and adds the string data back to the original files.

## How to Run It

Make sure you have a local copy of [d4data](https://github.com/blizzhackers/d4data) downloaded locally.

This runs over all of the JSON files in that directory. By default this looks at `../d4data` to find the appropriate JSON files. You can override this by setting the environment variable `D4DATA_DIR` (e.g. `export D4DATA_DIR=../my_d4data`).

Produced files attempt to mimic the original file structure in the `d4data` repository. Files that have no equivalent (such as specific areas of data that may be of higher interest) are in the `df_output` directory.

Use it with yarn: `yarn build && DEBUG=0 GRAPH=0 yarn start`. Setting `GRAPH=1` will *only* build graph output.

### Generating A Graph

You can generate a graph with relationships by specifying `GRAPH=1 DEPTH=N SNOID=<snoid> yarn start`. The `DEPTH` argument should be how many connections are explored both connecting to, and connecting out, from the given SNO ID. This produces a GraphViz-compatible `dot` file.

The whole graph is unrealistic to export at once.

There's a lot of nodes and edges - 327k nodes and 2.6M edges to be precise. Graphviz/dot doesn't really handle huge graphs well, at least in part because it can't take advantage of multiple threads.

You can try to generate the SVG using [Gephi](https://gephi.org/) with the OpenOrd layout with 2000 iterations. Make sure to increase Gephi's memory to the maximum (22G) if you want to export the graph. 

## "Why didn't you do X?"

... like write unit tests, or set up CI/CD, or write this in Rust, or ...

It's a hobby project for funsies until we find the cow level.

## Next Steps

There's a known bug that's only impacting two files: Quest/Dungeon_Affix_HellPortal.qst.json and Quest/CMP_Kehj_Omaths.qst.json. I decided to publish this now since I don't think that'll have an impact on cow hunting.

I'm doing a hilariously poor job of parsing and stringifying things. I wrote everything with string manipulation since I suspected that would be much faster than traversing each object, finding keys and values, going up a level and deleting keys, etc... but I may have been way off there. It would be cool to see an alternative, simpler approach using the parsed JSON objects.

It would be great to have even more information filtered out. I hit the low hanging fruit - `"value":-1` and `"value":2^32-1`. A static text filter would be really nice. 

There's also no grouped files. Lots of things fit well together as an "idea" - for example, an item and the item's actor data make sense to be melded into one. They don't exist without one another.

Another neat thing I wanted to do was add annotations to some of the conditional files. Things like `bNegate` and `eComparisonOp` could be read and understood then formed into higher-order logical conditions as emitted as a single new attribute on the conditionals.

It would be ideal to serialize the graph so it's faster to run lookup queries on it for different SNO IDs.

Finally, it's probably a separate project, but adding the ability to export all of this into something like a SQLite DB and host a tool in a browser looking at the data would be really cool.