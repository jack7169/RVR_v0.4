CC      ?= gcc
CFLAGS   = -Wall -Wextra -Werror -O2 -std=c11 -Iinclude
LDFLAGS  = -static

CROSS_CC = aarch64-linux-musl-gcc

SRCS = $(wildcard src/*.c)
OBJS = $(SRCS:src/%.c=src/%.o)

TARGET = l2tap

.PHONY: all cross clean

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $^

src/%.o: src/%.c include/l2tap.h
	$(CC) $(CFLAGS) -c -o $@ $<

cross:
	$(MAKE) CC=$(CROSS_CC) TARGET=l2tap-aarch64

clean:
	rm -f src/*.o $(TARGET) l2tap-aarch64
