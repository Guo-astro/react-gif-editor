
# A Rewrite of gif.js.optimized Supporting Modern React and TypeScript for ESM and CJS

[gif.js.optimized](https://www.npmjs.com/package/gif.js.optimized)

---

This version clarifies that the project is a rewrite of **gif.js.optimized** with support for modern React and TypeScript, and that it works with both ECMAScript modules (ESM) and CommonJS (CJS).

Below is a sample blog post that explains NeuQuant in detail—from the problem it solves to the mathematical underpinnings and algorithmic steps—with strict notation and examples.

---

# NeuQuant: A Neural Network Approach to Color Quantization


When you save an image as a GIF, you’re limited to a palette of at most 256 colors. For a typical full‑color image (which may contain millions of colors), this is a drastic reduction. In order to preserve visual quality while reducing the number of colors, the image must be "quantized"—that is, its full color spectrum is mapped to a smaller, representative palette. One elegant solution for this task is **NeuQuant**, a neural network (or self‑organizing map) that “learns” an optimal palette from the image.

In this post, we’ll explore NeuQuant step by step. We’ll use strict mathematical notation and concrete examples to show how the algorithm works.

---

## 1. The Need for Color Quantization

**Problem:**  
GIF images are limited to 256 colors. However, modern digital images usually use 24-bit color, meaning that each pixel is represented by 8 bits for red, 8 for green, and 8 for blue (i.e., $ 2^{24} $ possible colors). To convert a 24‑bit image to a GIF, we must choose a palette of 256 colors that best represents the original image.

**Solution:**  
NeuQuant uses a self‑organizing neural network to “learn” a palette from the image’s pixels. The network adjusts a set of neurons so that, after training, each neuron corresponds to one color in the final palette.

---

## 2. The Neural Network Structure

### Neuron Weight Vectors

Each neuron is represented by a weight vector. In NeuQuant the weight vector is defined strictly in the color space:

$$
\mathbf{w}_i = \begin{bmatrix} w_{i,0} \\ w_{i,1} \\ w_{i,2} \end{bmatrix} \in \mathbb{R}^3,\quad i = 0, 1, \dots, N-1,
$$

where:
- $ w_{i,0} $ corresponds to the blue channel,
- $ w_{i,1} $ corresponds to the green channel,
- $ w_{i,2} $ corresponds to the red channel.

For a standard GIF quantization, we set $ N = 256 $. The complete network is then represented by the weight matrix

$$
W = \begin{bmatrix}
\mathbf{w}_0^T \\
\mathbf{w}_1^T \\
\vdots \\
\mathbf{w}_{255}^T
\end{bmatrix} \in \mathbb{R}^{256 \times 3}.
$$

This means that the entire network contains $256 \times 3 = 768$ numbers.

### Initialization

Before training, the network’s neurons are initialized to uniformly cover the color space. A simplified version of the initialization is as follows:  
For $ i = 0, \dots, 255 $, set

$$
w_{i,j} = \frac{i \ll (\text{netbiasshift}+8)}{256} \quad \text{for } j=0,1,2.
$$

In simpler terms, you can think of the neurons being spread evenly across the range $[0, 255]$ for each color channel. (The actual implementation uses bit‑shifts for efficiency.)

---

## 3. The Training Process

NeuQuant processes pixels one by one (or via a sampling strategy) and adjusts the neurons to “move” toward the colors present in the image. Here’s a step‑by‑step look:

### 3.1. Finding the Best Matching Neuron

For an input pixel with color

$$
\mathbf{c} = \begin{bmatrix} B \\ G \\ R \end{bmatrix},
$$

we compute the “distance” between $ \mathbf{c} $ and each neuron $ \mathbf{w}_i $ using, for example, the Manhattan (L1) distance:

$$
d(i) = |w_{i,0} - B| + |w_{i,1} - G| + |w_{i,2} - R|.
$$

*Example:*  
Suppose our network is small and consists of three neurons (for illustration):

- **Neuron 0:** $ \mathbf{w}_0 = \begin{bmatrix} 0 \\ 0 \\ 0 \end{bmatrix} $
- **Neuron 1:** $ \mathbf{w}_1 = \begin{bmatrix} 127 \\ 127 \\ 127 \end{bmatrix} $
- **Neuron 2:** $ \mathbf{w}_2 = \begin{bmatrix} 255 \\ 255 \\ 255 \end{bmatrix} $

For an input pixel

$$
\mathbf{c} = \begin{bmatrix} 100 \\ 120 \\ 130 \end{bmatrix},
$$

the distances are:

- $ d(0) = |0-100| + |0-120| + |0-130| = 350 $
- $ d(1) = |127-100| + |127-120| + |127-130| = 27 + 7 + 3 = 37 $
- $ d(2) = |255-100| + |255-120| + |255-130| = 155 + 135 + 125 = 415 $

Neuron 1 is the best match because $ d(1) $ is smallest.

### 3.2. Updating the Winning Neuron

Once the winning neuron is determined, its weight vector is adjusted to move closer to the input color. The update rule is given by:

$$
w_{i^*,j} \leftarrow w_{i^*,j} - \frac{\alpha}{\text{initalpha}} \Bigl(w_{i^*,j} - c_j\Bigr),
$$

where
- $ i^* $ is the index of the winning neuron,
- $ c_j $ is the $ j $th component of the input color,
- $ \alpha $ is the current learning rate (which decays over time),
- $ \text{initalpha} $ is the initial learning rate.

*Example (Simplified):*  
If $ \alpha = \text{initalpha} $ (i.e. the learning rate is at its initial value), then

$$
w_{i^*,j} \leftarrow w_{i^*,j} - (w_{i^*,j} - c_j) = c_j.
$$

In our example, if neuron 1 wins then its new weight becomes exactly $ \begin{bmatrix} 100 \\ 120 \\ 130 \end{bmatrix} $.

### 3.3. Neighborhood Adjustment

Not only the winning neuron but also its neighbors (in the ordering of the network) are adjusted. For a neuron at a “distance” $ k $ from the winner, the update is scaled by a factor:

$$
w_{i,j} \leftarrow w_{i,j} - \frac{\alpha \cdot \text{radpower}[k]}{\text{alpharadbias}} \Bigl(w_{i,j} - c_j\Bigr).
$$

The factor $\text{radpower}[k]$ is computed as:

$$
\text{radpower}[k] = \alpha \cdot \frac{(r^2 - k^2) \cdot \text{radbias}}{r^2},
$$

where
- $ r $ is the current neighborhood radius,
- $ k $ is the distance index (with $ 0 \le k \le r $),
- $\text{radbias}$ is a constant.

As the training proceeds, both $\alpha$ (the learning rate) and $ r $ (the neighborhood radius) decay so that later updates are smaller.

---

## 4. Outcome: The Learned Palette

After processing many pixels, the neurons settle into values that best represent the colors found in the image. The final color palette is then simply

$$
\{\mathbf{w}_0,\, \mathbf{w}_1,\, \dots,\, \mathbf{w}_{255}\}.
$$

Remember, each $ \mathbf{w}_i $ is in $ \mathbb{R}^3 $ (with 3 components), so the overall network is a $256 \times 3$ matrix or a set of 768 values.

---

## 5. Recap and Summary

- **Objective:**  
  Reduce a full‑color image (millions of colors) to a GIF–compatible palette (256 colors).

- **Network Setup:**  
  The network consists of $ N = 256 $ neurons. Each neuron $ \mathbf{w}_i \in \mathbb{R}^3 $ represents a color, with $ \mathbf{w}_i = \begin{bmatrix} w_{i,0} \\ w_{i,1} \\ w_{i,2} \end{bmatrix} $. The overall network can be viewed as a $256 \times 3$ matrix.

- **Training Process:**  
  For each pixel $ \mathbf{c} $:
  1. Compute the distance to each neuron using  
     $$
     d(i) = |w_{i,0} - B| + |w_{i,1} - G| + |w_{i,2} - R|.
     $$
  2. Select the winning neuron $ i^* $ (the one with the smallest distance).
  3. Update the winner (and its neighbors) with  
     $$
     w_{i^*,j} \leftarrow w_{i^*,j} - \frac{\alpha}{\text{initalpha}} (w_{i^*,j} - c_j).
     $$
  4. Gradually decrease the learning rate $\alpha$ and the neighborhood radius $ r $.

- **Result:**  
  The network “learns” the best $256$ colors for the image, and the final palette is extracted from the weights of the neurons.

---

## Final Thoughts

NeuQuant is an efficient and elegant solution to the problem of color quantization. Its use of a self‑organizing map allows it to adapt to the color distribution of any image, and the careful mathematical updates ensure that the learned palette is a good approximation of the original colors. This palette can then be used to encode a GIF file that meets the format’s strict limitations.

Whether you’re building an image editor or just curious about how neural networks can solve practical problems, NeuQuant is a great example of combining simple mathematical ideas with efficient coding to achieve impressive results.

*Feel free to leave a comment if you have questions or want more details about any of the steps!*

---

*References:*  
- Anthony Dekker, “Kohonen neural networks for optimal colour quantization”, *Network: Computation in Neural Systems*, 1994.  
