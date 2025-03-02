# Implementing a Quadtree

⚠️  Generated fluff in here...

A quadtree is a powerful spatial partitioning structure used to efficiently manage two-dimensional space. It's especially useful in applications like collision detection, spatial indexing, and graphics rendering. Here’s how you can implement one from scratch.

### Defining a Quadtree Node

A quadtree consists of nodes that either store points or subdivide into four smaller regions when they reach a point limit. Here’s a simple Rust struct to represent a quadtree node:

```rust
struct QuadNode {
    limit: usize,
    region: Rect,
    points: Vec<(u32, Vec2)>,
    regions: Vec<Box<QuadNode>>,
}
```

- `limit`: Max number of points a node can hold before splitting.
- `region`: The rectangular space this node covers.
- `points`: List of points stored in this node.
- `regions`: Child nodes created when the node splits.

### Inserting Points

To insert a point, we first check if it’s inside the current node’s region. If the node hasn't split yet and has room, we store the point. Otherwise, we split the node and delegate insertion to the appropriate child.

```rust
fn add(&mut self, id: u32, position: &Vec2) {
    if !self.region.contains(position.clone()) {
        return;
    }

    if self.regions.is_empty() {
        if self.points.len() < self.limit {
            self.points.push((id, position.clone()));
        } else {
            self.split();
            self.add(id, position);
        }
        return;
    }

    for region in &mut self.regions {
        region.add(id, position);
    }
}
```

### Splitting a Node

When a node exceeds its point limit, it subdivides into four smaller regions. Existing points are then reassigned to the appropriate child node.

```rust
fn split(&mut self) {
    self.regions = self.make_regions();
    
    for (id, position) in self.points.drain(..) {
        for region in &mut self.regions {
            if region.region.contains(position.clone()) {
                region.add(id, &position);
            }
        }
    }
}
```

### Creating Subregions

Each split produces four smaller quadrants covering equal areas within the parent region.

```rust
fn make_regions(&self) -> Vec<Box<QuadNode>> {
    let (x, y, w, h) = (self.region.x, self.region.y, self.region.w / 2.0, self.region.h / 2.0);
    
    vec![
        Box::new(QuadNode::new(Rect::new(x, y, w, h), self.limit)),
        Box::new(QuadNode::new(Rect::new(x + w, y, w, h), self.limit)),
        Box::new(QuadNode::new(Rect::new(x, y + h, w, h), self.limit)),
        Box::new(QuadNode::new(Rect::new(x + w, y + h, w, h), self.limit)),
    ]
}
```

### Querying the Quadtree

To retrieve points within a specific area, we traverse the tree, collecting points from any intersecting nodes.

```rust
fn query(&self, query_area: &Rect) -> Vec<(u32, Vec2)> {
    let mut results = Vec::new();
    
    for node in &self.regions {
        if node.in_region(query_area) {
            if node.regions.is_empty() {
                results.extend(node.points.clone());
            } else {
                results.extend(node.query(query_area));
            }
        }
    }
    
    results
}
```

### Checking for Region Intersection

Before querying, we need a method to check if a region intersects with another.

```rust
fn in_region(&self, query_area: &Rect) -> bool {
    self.region.intersect(query_area.clone()).is_some()
}
```

### Example Usage

Let’s put everything together:

```rust
fn main() {
    let mut quadtree = QuadNode::new(Rect::new(0.0, 0.0, 100.0, 100.0), 10);

    quadtree.add(1, &Vec2::new(10.0, 10.0));
    quadtree.add(2, &Vec2::new(20.0, 20.0));
    quadtree.add(3, &Vec2::new(30.0, 30.0));

    let query_area = Rect::new(15.0, 15.0, 20.0, 20.0);
    let points = quadtree.query(&query_area);

    println!("Points in query area: {:?}", points);
}
```

> TOOD: continue
