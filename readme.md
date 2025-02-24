# Conway's Game of Life on the GPU

This is an implementation of the game of life using WebGL2. It uses two work
textures to simulate time steps, reading from the current one to get the state
of the board at this time step, rending the updated board to the other one, and
then rendering to the canvas. 

This implementation uses every single bit in the textures. A simple approach
would be to simply check if the texels surrounding each vertex have, say, their
R value set to 1.0, but this wastes most of the bits in the texture. The WebGL
spec only mandates that RBGA textures are renderable, and in the case of an
RBGA8 texture, that's 31 wasted bits.

This implementation uses RGBA8 textures, which have 4 channels with 8 bits
each. The canvas is partitioned into 4 rows and 8 columns. Each of these
subsections have texture coordinates running from 0.0-1.0 in their horizontal
and vertical axes. To access the bit corresponding to a given pixel, its
texture coordinates are used to determine which RGBA8 value in the texture to
access, and then the coordinates of it's subsection are used to determine which
bit within that texture sample. For rendering to the canvas, these can be
determined using gl_FragCoord. 

For performing the time steps and rendering to the other texture, a convolution
kernel is used. The kernel is centered on the cell that we are currently
updating. The iteration is done for each bit within a texture, requiring a loop
over the 32 bits, and for each bit, the 9 entries of the convolution are
summed. The index `i` for the convolution can be turned into an x and y offset
for texel access. The index `j` for the bits can be turned into a channel and
bit offset. In the event that the texel offset goes out of bounds of the
texture, the channel/bit offset is incremented/decremented, depending on if the
access went above/below the x/y boundary.

# Running

To run, clone the repo:
```
git clone git@github.com:noahmbright/webgl_game_of_life.git
```

Then simply open `/path/to/webgl_game_of_life/game_of_life.html` in a WebGL2
compatible browser.
