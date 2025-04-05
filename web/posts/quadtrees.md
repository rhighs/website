# Spatial partitioning for collision detection

[TOC]

## Introduction

When dealing with many objects on screen—bullets, particles, characters—collision detection can quickly become a bottleneck. Brute-force checks between all entities don’t scale. Spatial partitioning solves that. This article dives into 2D collision detection, the performance problem behind it, and how quadtrees make a difference. We'll walk through a real example using Rust and Macroquad.

## Spatial partitioning

### What is it about

Spatial partitioning breaks space into smaller sections so you don’t have to check every object against every other. It’s about reducing the number of comparisons by grouping things based on where they are.

### Where is it used

Games, simulations, physics engines—anywhere you need fast lookups of "what's near me". That includes:

- Broad-phase collision detection
- Raycasting acceleration
- Visibility checks
- Optimized rendering (e.g., culling)

### Focus on this article and introduce quadtrees

There are several partitioning methods—uniform grids, BSP trees, octrees, etc. We’ll focus on quadtrees: a recursive 2D structure that splits space into four quadrants. They’re simple, performant, and perfect for dynamic 2D worlds with objects of varying sizes and densities.

## 2D collision detection

### Common approach

The naive way: loop through every pair of objects and check if they collide. \( O(n^2) \) comparisons. Fine with a few objects. Useless with hundreds.

```rust
for i in 0..entities.len() {
    for j in (i+1)..entities.len() {
        check_collision(&entities[i], &entities[j]);
    }
}
```

### Scalability problem

This becomes unmanageable as soon as the object count grows. 1,000 objects means nearly 500,000 checks per frame. That's a frame-killer.

### Solutions

#### Grid approach

You divide the world into fixed-size cells. Each object goes into one or more cells. You only check collisions between objects in the same or neighboring cells.

- Simple
- Works well with uniform distributions
- Fails when objects cluster in a few cells

#### QuadTree approach

Instead of fixed-size divisions, quadtrees divide recursively. Sparse areas stay shallow. Dense regions subdivide. This keeps the object-per-region count low, and lookups efficient.

- Better adaptability to density
- More complex than grids
- Great for dynamic or hierarchical spaces

## Implementing a QuadTree

- Explain what we're going to build 
    - Simple circle moving on a black screen controlled with mouse
    - Falling bullets/particles
    - Collision resolution between: particle and circle using a constantly updated quadtree
    - Visualization of the quadtree on screen (togglable)
- Showcase of
    - Rust + Macroquad setup
    - Core code sections
    - Images
- Reference repository connect and/or demo webassemly URL (I'd use this, old but reproducible: https://github.com/rhighs/quadtree-demo)

